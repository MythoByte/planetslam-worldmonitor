import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPACE_BRIEF_INPUTS, validSpaceBrief, projectSpaceBrief } from '../api/_space-brief.js';
import { spaceEnvelope, spaceKey } from '../api/_space-data.js';
import { buildSpaceBrief, applySpaceBriefAi, generateSpaceBrief } from '../scripts/_space-brief.mjs';
import { seedSpace } from '../scripts/seed-space.mjs';

const now = Date.parse('2026-11-06T17:00:00Z');
const news = { dataset: 'news', fetchedAt: now, observedAt: now, data: { items: [{ id: 'n1', title: 'Synthetic orbital science update',
  summary: 'Researchers shared a new orbital science update.', publishedAt: now - 600_000, publisher: 'Synthetic publisher', url: 'https://example.org/science' }] } };
const launch = { dataset: 'launches', fetchedAt: now, observedAt: null, data: { items: [{ id: 'l1', name: 'Synthetic Falcon launch', net: now + 3600_000,
  status: 'Go for launch', rocket: 'Falcon', pad: 'Synthetic pad', url: 'https://example.org/launch' }] } };
function envelopes(extra = {}) { return Object.fromEntries(SPACE_BRIEF_INPUTS.map(name => [name, spaceEnvelope(name, ({ news, launches: launch, ...extra })[name], now)])); }
function base() { return buildSpaceBrief(envelopes(), now); }
function cache(initial = { [spaceKey('news')]: news, [spaceKey('launches')]: launch }) {
  const values = new Map(Object.entries(initial)); const tickets = new Set(); const calls = [];
  return { values, calls, command: async args => {
    calls.push(args);
    if (args[0] === 'GET') return { result: values.has(args[1]) ? JSON.stringify(values.get(args[1])) : null };
    if (args[0] === 'SET') { if (tickets.has(args[1])) return { result: null }; tickets.add(args[1]); return { result: 'OK' }; }
    throw new Error('Unexpected command');
  } };
}

test('brief selects bounded dated evidence, original links and all coverage gaps', () => {
  const value = base();
  assert.equal(validSpaceBrief(value), true);
  assert.equal(value.mode, 'source-summary'); assert.equal(value.model, null);
  assert.equal(value.date, '2026-11-06'); assert.equal(value.generatedAt, now);
  assert.equal(value.items.length, 2); assert.equal(value.coverage.length, 10);
  assert.deepEqual(value.sources.map(item => item.url), ['https://example.org/science', 'https://example.org/launch']);
  assert.equal(value.coverage.find(item => item.dataset === 'weather').status, 'unavailable');
  assert.ok(value.limitations.some(text => text.includes('not a live forecast')));
});


test('per-item publication clocks stay attached to their linked sources and weather observation expiry survives new fetches', () => {
  const multi = structuredClone(news);
  multi.data.items.push({ ...multi.data.items[0], id: 'n2', url: 'https://example.org/second', publishedAt: now - 7200_000 });
  const weather = { dataset: 'weather', fetchedAt: now, observedAt: now - 50 * 60_000, data: { scales: { G: 0, R: 0, S: 0 }, kp: [{ time: now, value: 1 }], wind: [{ time: now, speed: 300 }], alerts: [] } };
  const value = buildSpaceBrief(envelopes({ news: multi, weather }), now);
  assert.deepEqual(value.sources.filter(item => item.dataset === 'news').map(item => item.observedAt), [now - 600_000, now - 7200_000]);
  assert.equal(value.sources.find(item => item.dataset === 'weather').expiresAt, now + 10 * 60_000);
  const projected = projectSpaceBrief({ dataset: 'brief', data: value, fetchedAt: now }, now + 11 * 60_000);
  assert.equal(projected.data.coverage.find(item => item.dataset === 'weather').status, 'unavailable');
  assert.equal(projected.data.sources.find(item => item.dataset === 'weather').status, 'stale');
});

test('expired, malformed, unsafe-link or out-of-window sources cannot make a confident empty brief', () => {
  assert.equal(buildSpaceBrief({}, now), null);
  const expired = { ...news, fetchedAt: now - 7 * 3600_000 };
  const snapshots = envelopes({ news: expired, launches: null });
  assert.equal(buildSpaceBrief(snapshots, now), null);
  for (const url of ['javascript:alert(1)', 'http://example.org/item', 'https://user:pass@example.org/item']) {
    const changed = structuredClone(news); changed.data.items[0].url = url;
    assert.equal(buildSpaceBrief(envelopes({ news: changed, launches: null }), now), null);
  }
  const changed = structuredClone(news); changed.data.items[0].publishedAt = now + 3600_000;
  assert.equal(buildSpaceBrief(envelopes({ news: changed, launches: null }), now), null);
});

test('weather facts preserve explicit source scales and partial availability without global all-clear', () => {
  const weather = { dataset: 'weather', fetchedAt: now, observedAt: now - 60_000, data: { scales: { G: 2, R: 1, S: 0 }, kp: [{ time: now, value: 5 }], wind: [{ time: now, speed: 400 }], alerts: [] } };
  const value = buildSpaceBrief(envelopes({ weather }), now);
  assert.match(value.items.find(item => item.heading === 'Space weather snapshot').summary, /G2.*R1.*S0/);
  assert.equal(value.coverage.find(item => item.dataset === 'neo').status, 'unavailable');
  assert.ok(!value.items.some(item => /all clear|no danger|nothing happened/i.test(item.summary)));
});

test('reader expires dated brief independently of fetch clock and reclassifies source clocks', () => {
  const data = base();
  const snapshot = { dataset: 'brief', fetchedAt: now, observedAt: now, data };
  assert.equal(projectSpaceBrief(snapshot, now).status, 'fresh');
  const olderSources = projectSpaceBrief(snapshot, now + 7 * 3600_000);
  assert.equal(olderSources.status, 'stale'); // next UTC day
  assert.equal(olderSources.data.sources[0].status, 'stale');
  assert.equal(olderSources.data.coverage.find(item => item.dataset === 'news').status, 'unavailable');
  assert.equal(projectSpaceBrief({ ...snapshot, fetchedAt: now + 47 * 3600_000 }, now + 49 * 3600_000).status, 'unavailable');
  assert.equal(projectSpaceBrief(snapshot, now - 3600_000).status, 'unavailable');
  assert.equal(spaceEnvelope('brief', snapshot, now).data.date, data.date);
});

test('cached malformed brief is rejected before UI fields or links are consumed', () => {
  const value = base();
  for (const change of [data => { data.items[0].summary = null; }, data => { data.items[0].sourceIds = ['invented']; },
    data => { data.sources[0].url = 'javascript:alert(1)'; }, data => { data.coverage[0].dataset = 'invented'; },
    data => { data.coverage[0].fetchedAt = NaN; }, data => { data.sources[0].id = data.sources[1].id; },
    data => { data.date = '2026-01-01'; }, data => { data.mode = 'ai'; data.model = null; }]) {
    const bad = structuredClone(value); change(bad);
    assert.equal(validSpaceBrief(bad), false);
    assert.equal(projectSpaceBrief({ dataset: 'brief', fetchedAt: now, data: bad }, now).data, null);
  }
});

test('AI enrichment cannot inject URLs, new citations, switched IDs, new facts or alternate metadata', () => {
  const value = base();
  const good = { items: value.items.map(item => ({ id: item.id, summary: item.summary })) };
  const enriched = applySpaceBriefAi(value, JSON.stringify(good), 'synthetic-model');
  assert.equal(enriched.mode, 'ai'); assert.equal(enriched.model, 'synthetic-model');
  assert.deepEqual(enriched.sources, value.sources); assert.deepEqual(enriched.items.map(item => item.sourceIds), value.items.map(item => item.sourceIds));
  for (const mutate of [data => { data.items[0].summary += ' https://evil.example'; }, data => { data.items[0].sourceIds = ['s2']; },
    data => { data.items[0].id = data.items[1].id; }, data => { data.items.reverse(); }, data => { data.items[0].summary += ' 99999 spacecraft.'; },
    data => { data.items[1].summary += ' The launch was canceled after failure.'; }, data => { data.items[0].summary += ' A collision will impact Earth.'; }, data => { data.title = 'Invented title'; }, data => { data.items[0].summary = '<script>alert(1)</script>'; }]) {
    const bad = structuredClone(good); mutate(bad); assert.equal(applySpaceBriefAi(value, JSON.stringify(bad), 'synthetic-model'), null);
  }
  assert.equal(applySpaceBriefAi(value, 'not json', 'synthetic-model'), null);
});


test('AI cannot escalate scientific scale classifications or remove source uncertainty caveats', () => {
  const weather = { dataset: 'weather', fetchedAt: now, observedAt: now, data: { scales: { G: 0, R: 0, S: 0 }, kp: [{ time: now, value: 1 }], wind: [{ time: now, speed: 300 }], alerts: [] } };
  const value = buildSpaceBrief(envelopes({ weather }), now);
  const output = { items: value.items.map(item => ({ id: item.id, summary: item.summary })) };
  output.items.find(item => item.summary.includes('G0')).summary = value.items.find(item => item.summary.includes('G0')).summary.replace('G0', 'G5');
  assert.equal(applySpaceBriefAi(value, JSON.stringify(output), 'synthetic-model'), null);
  output.items = value.items.map(item => ({ id: item.id, summary: item.summary.replace('Schedule can change.', '') }));
  assert.equal(applySpaceBriefAi(value, JSON.stringify(output), 'synthetic-model'), null);
});

test('no AI key uses labeled source summary without consuming AI budget or requesting a model', async () => {
  const store = cache(); let calls = 0;
  const result = await generateSpaceBrief({ command: store.command, now, aiEnabled: false, llm: async () => { calls++; throw Error('unexpected'); } });
  assert.equal(result.data.mode, 'source-summary'); assert.equal(calls, 0);
  assert.ok(store.calls.every(args => args[0] === 'GET'));
});

test('daily UTC AI admission bounds repeated worker calls and keeps source summary on invalid/failing AI', async () => {
  const store = cache(); let calls = 0;
  const llm = async (_system, prompt, opts) => {
    calls++; assert.deepEqual(opts.allowedProviders, ['openrouter']); assert.equal(opts.timeoutMs, 20_000);
    assert.equal(opts.maxTokens, 1500); assert.ok(prompt.length < 20_000); return '{"items":[]}';
  };
  const first = await generateSpaceBrief({ command: store.command, now, aiEnabled: true, llm });
  const second = await generateSpaceBrief({ command: store.command, now: now + 60_000, aiEnabled: true, llm });
  assert.equal(first.data.mode, 'source-summary'); assert.equal(second.data.mode, 'source-summary'); assert.equal(calls, 1);
  assert.ok(store.calls.some(args => args[0] === 'SET' && args[1] === 'space:brief:ai:v1:2026-11-06' && args.includes('NX')));
  const throwing = cache();
  assert.equal((await generateSpaceBrief({ command: throwing.command, now, aiEnabled: true, llm: async () => { throw Error('Synthetic failure'); } })).data.mode, 'source-summary');
});

test('valid current UTC brief skips all source and AI calls; new UTC day may generate a new one', async () => {
  const store = cache({ [spaceKey('brief')]: { dataset: 'brief', fetchedAt: now, data: base() } });
  assert.deepEqual(await generateSpaceBrief({ command: store.command, now, aiEnabled: true }), { skipped: 'current' });
  assert.equal(store.calls.length, 1);
  store.values.set(spaceKey('news'), { ...news, fetchedAt: now + DAY, observedAt: now + DAY, data: { items: [{ ...news.data.items[0], publishedAt: now + DAY }] } });
  const next = await generateSpaceBrief({ command: store.command, now: now + DAY, aiEnabled: false });
  assert.equal(next.data.date, '2026-11-07');
});
const DAY = 86400_000;

test('all unavailable sources and Redis admission errors fail closed without AI or fabricated output', async () => {
  const empty = cache({}); let calls = 0;
  await assert.rejects(generateSpaceBrief({ command: empty.command, now, aiEnabled: true, llm: async () => { calls++; } }), /no usable evidence/);
  assert.equal(calls, 0); assert.ok(empty.calls.every(args => args[0] === 'GET'));
  const store = cache();
  await assert.rejects(generateSpaceBrief({ command: args => args[0] === 'SET' ? Promise.resolve({ error: 'unavailable' }) : store.command(args), now, aiEnabled: true,
    llm: async () => { calls++; } }), /admission unavailable/);
  assert.equal(calls, 0);
});

test('Space worker publishes brief and seed-meta atomically, preserves last-good on failure and honors cooldown', async () => {
  const store = cache(); let published = null;
  const result = await seedSpace({ now, names: ['brief'], generateBrief: options => generateSpaceBrief({ ...options, aiEnabled: false }), command: store.command, lock: async () => true, unlock: async () => {},
    publish: async value => { published = value; } });
  assert.equal(result[0].status, 'published'); assert.equal(published.key, 'space:brief:v1');
  assert.equal(published.extra.dataset, 'brief'); assert.equal(published.recordCount, 2); assert.equal(published.data.data.generatedAt, now);
  const again = await seedSpace({ now, names: ['brief'], generateBrief: options => generateSpaceBrief({ ...options, aiEnabled: false }), command: store.command, lock: async () => true, unlock: async () => {}, publish: async () => assert.fail('cooldown write') });
  assert.equal(again[0].status, 'cooldown');
  const empty = cache({});
  const failed = await seedSpace({ now, names: ['brief'], generateBrief: options => generateSpaceBrief({ ...options, aiEnabled: false }), command: empty.command, lock: async () => true, unlock: async () => {}, publish: async () => assert.fail('must preserve last good') });
  assert.equal(failed[0].status, 'failed');
});
