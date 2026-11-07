import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earthKey } from '../api/_earth-data.js';
import { EARTH_HISTORY_KEY, EARTH_HISTORY_SOURCE_IDS, EARTH_HISTORY_INTERVAL_MS as HOUR, EARTH_HISTORY_RETENTION_MS as WEEK,
  EARTH_HISTORY_MAX_BYTES, appendEarthHistory, earthHistoryEnvelope, validEarthHistory } from '../api/_earth-history.js';
import { seedEarthHistory } from '../scripts/seed-earth.mjs';
import handler from '../api/earth.js';
const now = Date.now();
const event = (delta = 0) => ({ id: 'nws:synthetic', sourceId: 'nws', title: 'Synthetic winter warning', kind: 'weather',
  latitude: 40, longitude: -80, region: 'North America', severity: 'severe', status: 'Winter Storm Warning', mode: 'warning',
  observedAt: now - 1000, expiresAt: now + HOUR + delta, url: 'https://example.org/synthetic', provider: 'Synthetic NWS', summary: 'Synthetic fixture' });
const snap = (items = [event()], at = now) => ({ nws: { sourceId: 'nws', dataset: 'alerts', fetchedAt: at, observedAt: at, data: { items } } });

test('history shares event revisions and records real capture times without interpolating missed hours', () => {
  const first = appendEarthHistory(null, snap(), now);
  assert.equal(validEarthHistory(first, now), true);
  assert.equal(first.items[0].totalEvents, 1);
  assert.equal(first.items[0].sources.find(source => source.id === 'gdacs').status, 'unavailable');
  assert.equal(appendEarthHistory(first, snap(), now + HOUR - 1), null);
  // Unchanged USGS events allow revision reuse across long gaps; NWS cache is re-fetched.
  const future = now + 3 * HOUR;
  const source = snap([{ ...event(), expiresAt: future + 2 * HOUR }], future);
  const second = appendEarthHistory(first, source, future);
  const third = appendEarthHistory(second, snap(source.nws.data.items, future + HOUR), future + HOUR);
  assert.deepEqual(third.items.map(frame => frame.recordedAt), [now, future, future + HOUR]);
  assert.equal(third.events.length, 2);
  assert.deepEqual(third.items[1].eventKeys, third.items[2].eventKeys);
  assert.notDeepEqual(third.items[0].eventKeys, third.items[1].eventKeys);
});

test('historical warnings survive current expiry, but retained frames expire after seven days', () => {
  const archive = appendEarthHistory(null, snap(), now);
  const envelope = earthHistoryEnvelope(archive, now + 3 * HOUR);
  assert.equal(envelope.status, 'stale');
  assert.equal(envelope.data.events[0].event.expiresAt, now + HOUR);
  assert.equal(envelope.data.items.length, 1);
  assert.equal(earthHistoryEnvelope(archive, now + WEEK).status, 'unavailable');
  assert.equal(earthHistoryEnvelope(archive, now + WEEK).data.events.length, 0);
});

test('an unavailable feed is distinct from an available feed reporting zero events', () => {
  assert.equal(appendEarthHistory(null, {}, now), null);
  const empty = appendEarthHistory(null, snap([]), now);
  assert.equal(empty.items[0].totalEvents, 0);
  assert.equal(empty.items[0].sources.find(source => source.id === 'nws').status, 'fresh');
  assert.equal(earthHistoryEnvelope(empty, now).status, 'fresh');
});

test('history rejects malformed archives and missing event references rather than invent past data', () => {
  const archive = appendEarthHistory(null, snap(), now);
  const missing = structuredClone(archive); missing.items[0].eventKeys = ['missing'];
  assert.equal(validEarthHistory(missing, now), false);
  assert.equal(earthHistoryEnvelope(missing, now).status, 'unavailable');
  const badEvent = structuredClone(archive); badEvent.events[0].event.url = 'javascript:alert(1)';
  assert.equal(validEarthHistory(badEvent, now), false);
  const future = structuredClone(archive); future.items[0].recordedAt = now + WEEK;
  assert.equal(validEarthHistory(future, now), false);
  assert.throws(() => appendEarthHistory(missing, snap(), now + HOUR));
});

test('bounded captures report truncation and evict complete oldest frames when capacity is reached', () => {
  const many = Array.from({ length: 510 }, (_, index) => ({ ...event(), id: `synthetic-${index}`, summary: 'x'.repeat(5000) }));
  const archive = appendEarthHistory(null, snap(many), now);
  assert.equal(archive.items[0].totalEvents, 510);
  assert.equal(archive.items[0].truncated, true);
  assert.ok(archive.items[0].eventKeys.length < 500);
  assert.ok(new TextEncoder().encode(JSON.stringify(archive)).length <= EARTH_HISTORY_MAX_BYTES);
  const next = appendEarthHistory(archive, snap(many.map(item => ({ ...item, title: 'Updated synthetic warning', expiresAt: now + 4 * HOUR })), now + HOUR), now + HOUR);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].recordedAt, now + HOUR);
  assert.equal(validEarthHistory(next, now + HOUR), true);
});

test('producer serializes archive writes, honors interval and preserves prior data on failed reads', async () => {
  const writes = [], commands = [], unlocks = [];
  const source = snap();
  const options = { now, lock: async () => true, unlock: async domain => unlocks.push(domain), publish: async write => writes.push(write),
    command: async command => { commands.push(command); return { result: command[0] === 'GET' ? null : EARTH_HISTORY_SOURCE_IDS.map(id => source[id] ? JSON.stringify(source[id]) : null) }; } };
  assert.equal((await seedEarthHistory({ ...options, lock: async () => false })).status, 'locked');
  assert.equal(commands.length, 0);
  assert.equal((await seedEarthHistory(options)).status, 'published');
  assert.equal(writes[0].key, EARTH_HISTORY_KEY);
  assert.equal(writes[0].recordCount, 1);
  assert.equal(writes[0].extra.sourceVersion, 'earth-history-v1');
  assert.deepEqual(commands[1], ['MGET', ...EARTH_HISTORY_SOURCE_IDS.map(earthKey)]);
  const previous = writes[0].data;
  writes.length = 0;
  assert.equal((await seedEarthHistory({ ...options, command: async () => ({ result: JSON.stringify(previous) }) })).status, 'cooldown');
  assert.equal((await seedEarthHistory({ ...options, now: now + HOUR, command: async () => { throw new Error('storage outage'); } })).status, 'failed');
  assert.equal((await seedEarthHistory({ ...options, command: async () => ({ result: 'malformed' }) })).status, 'failed');
  assert.equal(writes.length, 0);
  assert.deepEqual(unlocks, ['earth:history', 'earth:history', 'earth:history', 'earth:history']);
});

test('producer preserves last-good archive when publication fails, with no success clock', async () => {
  let publishes = 0;
  const source = snap();
  const result = await seedEarthHistory({ now, lock: async () => true, unlock: async () => {}, publish: async () => { publishes++; throw new Error('publish outage'); },
    command: async command => ({ result: command[0] === 'GET' ? null : EARTH_HISTORY_SOURCE_IDS.map(id => source[id] ? JSON.stringify(source[id]) : null) }) });
  assert.equal(result.status, 'failed');
  assert.equal(publishes, 1);
});

test('history API reads only the archive key without upstream calls or current-alert expiry', async () => {
  const archive = appendEarthHistory(null, snap(), now);
  const priorFetch = globalThis.fetch, priorUrl = process.env.UPSTASH_REDIS_REST_URL, priorToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://synthetic-redis.example.org'; process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-token';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, commands: JSON.parse(options.body) });
    return Response.json([{ result: JSON.stringify(archive) }]);
  };
  try {
    const response = await handler(new Request('https://planetslam.com/api/earth?dataset=history'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.dataset, 'history');
    assert.equal(body.data.items[0].recordedAt, now);
    assert.deepEqual(calls, [{ url: 'https://synthetic-redis.example.org/pipeline', commands: [['GET', EARTH_HISTORY_KEY]] }]);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = priorUrl;
    if (priorToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = priorToken;
  }
});

test('rolling retention keeps at most168 actual hourly frames and drops unreferenced revisions', () => {
  let archive = null;
  for (let hour = 0; hour <= 168; hour++) {
    const at = now + hour * HOUR;
    archive = appendEarthHistory(archive, snap([], at), at);
  }
  assert.equal(archive.items.length, 168);
  assert.equal(archive.items[0].recordedAt, now + HOUR);
  assert.equal(archive.items.at(-1).recordedAt, now + 168 * HOUR);
  assert.equal(archive.events.length, 0);
  const old = appendEarthHistory(null, snap(), now);
  const afterGap = appendEarthHistory(old, snap([], now + WEEK), now + WEEK);
  assert.equal(afterGap.items.length, 1);
  assert.equal(afterGap.events.length, 0);
});

test('concurrent producers cannot overwrite each other through the archive lock', async () => {
  let held = false, releaseRead;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  const writes = [];
  const source = snap();
  const options = { now, lock: async () => { if (held) return false; held = true; return true; }, unlock: async () => { held = false; },
    publish: async write => writes.push(write), command: async command => {
      if (command[0] === 'GET') { await readGate; return { result: null }; }
      return { result: EARTH_HISTORY_SOURCE_IDS.map(id => source[id] ? JSON.stringify(source[id]) : null) };
    } };
  const first = seedEarthHistory(options);
  const second = await seedEarthHistory(options);
  assert.equal(second.status, 'locked');
  releaseRead();
  assert.equal((await first).status, 'published');
  assert.equal(writes.length, 1);
  assert.equal(held, false);
});


test('future and expired legacy records cannot prevent capture of healthy sources or imply an all-clear', () => {
  const historical = { ...event(), id: 'eonet:expired', sourceId: 'eonet', expiresAt: now - 1 };
  const future = { ...historical, id: 'eonet:future', observedAt: now + HOUR, expiresAt: null };
  const broken = { eonet: { sourceId: 'eonet', dataset: 'events', fetchedAt: now, observedAt: now + HOUR, data: { items: [historical, future] } } };
  assert.equal(appendEarthHistory(null, broken, now), null);
  const archive = appendEarthHistory(null, { ...snap(), ...broken }, now);
  assert.equal(validEarthHistory(archive, now), true);
  assert.equal(archive.events.length, 1);
  assert.equal(archive.events[0].event.sourceId, 'nws');
  const source = archive.items[0].sources.find(source => source.id === 'eonet');
  assert.equal(source.status, 'unavailable');
  assert.match(source.message, /2 event records omitted/);
  const valid = { ...historical, id: 'eonet:current', observedAt: now - 1000, expiresAt: null };
  broken.eonet.data.items.push(valid);
  const partial = appendEarthHistory(null, broken, now);
  assert.equal(partial.items[0].sources.find(source => source.id === 'eonet').status, 'stale');
  assert.equal(partial.events.length, 1);
  assert.equal(partial.events[0].event.id, 'eonet:current');
});
