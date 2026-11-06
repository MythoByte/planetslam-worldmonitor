import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMissions, fetchMissions, missionDatePrecision, missionDurationSeconds, admitTsdRequest } from '../scripts/_space-missions.mjs';
import { spaceEnvelope } from '../api/_space-data.js';
import { seedSpace } from '../scripts/seed-space.mjs';
import { missionPrecisionPeriodEnd, missionStillUpcoming, validMissionData } from '../api/_space-missions.js';

const now = Date.parse('2026-11-06T15:00:00Z');
const event = (overrides = {}) => ({ id: 123, name: 'ISS spacewalk', date: '2026-11-07T12:00:00Z', type: { name: 'EVA' },
  date_precision: { name: 'Minute', description: 'Time accurate to the minute.' }, description: 'Mission detail', location: 'ISS',
  duration: 'PT6H30M', vid_urls: [{ priority: 1, url: 'https://www.youtube.com/watch?v=example' }], info_urls: [{ url: 'https://www.nasa.gov/live/' }],
  last_updated: '2026-11-05T12:00:00Z', launches: [{ id: 'launch-id' }], ...overrides });
const response = (...items) => ({ count: items.length, results: items });

test('mission records preserve source timing, precision, duration, links and estimate status', () => {
  const item = normalizeMissions(response(event()), now).data.items[0];
  assert.equal(item.id, '123');
  assert.equal(item.kind, 'spacewalk');
  assert.equal(item.date, Date.parse('2026-11-07T12:00:00Z'));
  assert.equal(item.datePrecision, 'minute');
  assert.equal(item.durationSeconds, 23400);
  assert.equal(item.windowStart, null);
  assert.equal(item.windowEnd, null);
  assert.equal(item.status, 'Scheduled · provider estimate');
  assert.equal(item.url, 'https://www.nasa.gov/live/');
  assert.deepEqual(item.launchIds, ['launch-id']);
});

test('provider event type wins over words in a briefing title', () => {
  const items = normalizeMissions(response(event({ id: 1, name: 'EVA press conference', type: { name: 'Press Event' } }),
    event({ id: 2, type: { name: 'Spacecraft Berthing' } }), event({ id: 3, type: { name: 'Spacecraft Landing' } })), now).data.items;
  assert.deepEqual(items.map(item => item.kind), ['briefing', 'docking', 'landing']);
});

test('day/month/year/unknown precision never becomes minute precision', () => {
  assert.equal(missionDatePrecision('Minute'), 'minute');
  assert.equal(missionDatePrecision('Second'), 'second');
  for (const value of ['Day', 'Month', 'Year', 'Quarter']) assert.equal(missionDatePrecision(value), value.toLowerCase());
  assert.equal(missionDatePrecision('Approximate'), 'unknown');
  assert.equal(missionDatePrecision(undefined), 'unknown');
});

test('coarse schedules stay visible through their UTC day/month/quarter/year without inventing event windows', () => {
  const raw = response(event({ id: 1, date: '2026-11-06T00:00:00Z', date_precision: { name: 'Day' } }),
    event({ id: 2, date: '2026-11-01T00:00:00Z', date_precision: { name: 'Month' } }),
    event({ id: 3, date: '2026-10-01T00:00:00Z', date_precision: { name: 'Quarter' } }),
    event({ id: 4, date: '2026-01-01T00:00:00Z', date_precision: { name: 'Year' } }));
  const normalized = normalizeMissions(raw, now);
  assert.equal(normalized.data.items.length, 4);
  const snapshot = { dataset: 'missions', fetchedAt: now - 60_000, data: normalized.data };
  const cached = spaceEnvelope('missions', snapshot, now);
  assert.equal(cached.data.items.length, 4);
  assert.equal(cached.fetchedAt, now - 60_000);
  for (const item of cached.data.items) {
    assert.equal(item.windowStart, null);
    assert.equal(item.windowEnd, null);
    assert.ok(item.date < now);
  }
  const byId = new Map(cached.data.items.map(item => [item.id, item]));
  assert.equal(missionPrecisionPeriodEnd(byId.get('1')), Date.parse('2026-11-07T00:00:00Z'));
  assert.equal(missionPrecisionPeriodEnd(byId.get('2')), Date.parse('2026-12-01T00:00:00Z'));
  assert.equal(missionPrecisionPeriodEnd(byId.get('3')), Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(missionPrecisionPeriodEnd(byId.get('4')), Date.parse('2027-01-01T00:00:00Z'));
});

test('coarse schedules expire at exclusive UTC period boundaries including leap February', () => {
  for (const [precision, value, end] of [['day', '2026-11-06', '2026-11-07'], ['month', '2028-02-01', '2028-03-01'],
    ['quarter', '2026-10-01', '2027-01-01'], ['year', '2026-01-01', '2027-01-01']]) {
    const item = { ...normalizeMissions(response(event()), now).data.items[0], id: '1', name: 'Estimated event', date: Date.parse(`${value}T00:00:00Z`), datePrecision: precision, status: 'Scheduled', kind: 'other', launchIds: [] };
    const boundary = Date.parse(`${end}T00:00:00Z`);
    assert.equal(missionStillUpcoming(item, boundary - 1), true);
    assert.equal(missionStillUpcoming(item, boundary), false);
    const cached = spaceEnvelope('missions', { dataset: 'missions', fetchedAt: boundary - 60_000, data: { items: [item], totalCount: 1, truncated: false } }, boundary);
    assert.deepEqual(cached.data.items, []);
    assert.equal(cached.status, 'fresh');
  }
});

test('precise and unknown timestamps retain their instant cutoff rather than acquiring a coarse window', () => {
  for (const precision of ['second', 'minute', 'hour', 'unknown']) {
    const item = { name: 'Event', date: now, datePrecision: precision, status: 'Scheduled' };
    assert.equal(missionPrecisionPeriodEnd(item), now);
    assert.equal(missionStillUpcoming(item, now), true);
    assert.equal(missionStillUpcoming(item, now + 1), false);
  }
});

test('UTC timestamps and explicit provider windows stay distinct from approximate dates', () => {
  const item = normalizeMissions(response(event({ date: '2026-11-07T14:00:00+02:00', date_precision: { name: 'Month' },
    window_start: '2026-11-07T11:30:00Z', window_end: '2026-11-07T13:00:00Z' })), now).data.items[0];
  assert.equal(item.date, Date.parse('2026-11-07T12:00:00Z'));
  assert.equal(item.datePrecision, 'month');
  assert.equal(item.windowStart, Date.parse('2026-11-07T11:30:00Z'));
  assert.equal(item.windowEnd, Date.parse('2026-11-07T13:00:00Z'));
});

test('normalization removes past, cancelled and terminal events but preserves valid quiet batch', () => {
  const result = normalizeMissions(response(event({ id: 1, date: '2026-11-05T12:00:00Z' }), event({ id: 2, status: { name: 'Cancelled' } }),
    event({ id: 3, name: 'Canceled: launch briefing' }), event({ id: 4, status: 'Completed' })), now);
  assert.deepEqual(result.data.items, []);
  assert.equal(result.data.totalCount, 4);
  assert.deepEqual(normalizeMissions({ count: 0, results: [] }, now).data.items, []);
});

test('malformed or all-invalid nonempty responses are failures, rather than an empty mission schedule', () => {
  for (const raw of [{}, { count: 1, results: [] }, { count: 0, results: [event()] }, response({ id: 1, date: 'bad', name: 'Bad date' })]) {
    assert.throws(() => normalizeMissions(raw, now));
  }
});

test('unsafe links are dropped and provider pagination is explicit without following it', () => {
  const result = normalizeMissions({ count: 100, next: 'https://example.org/next', results: [event({ info_urls: [{ url: 'javascript:alert(1)' }],
    url: 'https://ll.thespacedevs.com/2.3.0/events/123/', vid_urls: [{ url: 'http://example.org/unsafe' }] })] }, now);
  assert.equal(result.data.truncated, true);
  assert.equal(result.data.totalCount, 100);
  assert.equal(result.data.items[0].webcastUrl, '');
  assert.match(result.data.items[0].url, /^https:\/\/ll\.thespacedevs/);
});

test('mission cache reader filters expired events without renewing source clocks and rejects legacy payloads', () => {
  const normalized = normalizeMissions(response(event()), now);
  const fetchedAt = now - 60_000;
  const first = spaceEnvelope('missions', { dataset: 'missions', fetchedAt, data: normalized.data }, now);
  assert.equal(first.status, 'fresh');
  assert.equal(first.fetchedAt, fetchedAt);
  const passed = spaceEnvelope('missions', { dataset: 'missions', fetchedAt: first.data.items[0].date - 60_000, data: normalized.data }, first.data.items[0].date + 1);
  assert.deepEqual(passed.data.items, []);
  assert.equal(passed.status, 'fresh');
  assert.equal(spaceEnvelope('missions', { dataset: 'missions', fetchedAt, data: { items: [] } }, now).status, 'unavailable');
  assert.equal(spaceEnvelope('missions', { dataset: 'missions', fetchedAt: now - 7 * 3600_000, data: normalized.data }, now).data, null);
});

test('runtime mission contract rejects malformed fields consumed by the UI', () => {
  const data = normalizeMissions(response(event()), now).data;
  assert.equal(validMissionData(data), true);
  const malformed = [
    { description: null }, { type: 4 }, { location: [] }, { datePrecisionDescription: undefined }, { name: '' }, { status: null },
    { id: 'id with spaces' }, { description: 'x'.repeat(6001) }, { url: 'javascript:alert(1)' }, { url: 'https://user:pass@example.org/' },
    { webcastUrl: 'http://example.org/' }, { webcastUrl: null }, { windowStart: 'not-a-time' }, { windowEnd: Infinity },
    { windowStart: now + 2000, windowEnd: now + 1000 }, { updatedAt: 'yesterday' }, { date: 1e20 },
    { durationSeconds: -1 }, { durationSeconds: NaN }, { durationSeconds: '60' }, { durationSeconds: undefined },
    { launchIds: [null] }, { launchIds: ['x'.repeat(129)] }, { launchIds: Array(101).fill('launch') },
  ];
  for (const fields of malformed) {
    const invalid = { ...data, items: [{ ...data.items[0], ...fields }] };
    assert.equal(validMissionData(invalid), false, Object.keys(fields).join(','));
    const cached = spaceEnvelope('missions', { dataset: 'missions', fetchedAt: now, data: invalid }, now);
    assert.equal(cached.status, 'unavailable');
    assert.equal(cached.data, null);
  }
  const nullable = { ...data, items: [{ ...data.items[0], windowStart: null, windowEnd: null, updatedAt: null, durationSeconds: null, webcastUrl: '', launchIds: [] }] };
  assert.equal(validMissionData(nullable), true);
});

test('duration parsing supports ISO and Django strings without inventing absent durations', () => {
  assert.equal(missionDurationSeconds('PT1H30M'), 5400);
  assert.equal(missionDurationSeconds('1 02:30:00'), 95400);
  assert.equal(missionDurationSeconds('06:30:00'), 23400);
  for (const value of [null, 'unknown', '-1', -1, 'P99D', '00:99:00']) assert.equal(missionDurationSeconds(value), null);
});

test('missions provider uses one upcoming page without a date filter hiding coarse estimates', async () => {
  const calls = [];
  const result = await fetchMissions({ now, launchKey: 'synthetic-key', fetchFn: async (target, options) => {
    calls.push({ target: new URL(target), options }); return Response.json({ count: 0, next: null, results: [] });
  } });
  assert.equal(result.data.items.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target.pathname, '/2.3.0/events/upcoming/');
  assert.equal(calls[0].target.searchParams.get('limit'), '30');
  assert.equal(calls[0].target.searchParams.has('date__gte'), false);
  assert.equal(calls[0].options.headers.Authorization, 'Token synthetic-key');
  assert.equal(calls[0].options.redirect, 'error');
});

test('shared rolling-hour provider tickets cap launches and missions together across restarts', async () => {
  let clock = now;
  const tickets = new Map();
  const command = async cmd => {
    assert.equal(cmd[0], 'SET'); assert.equal(cmd[3], 'NX'); assert.equal(cmd[4], 'PX'); assert.equal(cmd[5], 3600_000);
    if ((tickets.get(cmd[1]) || 0) > clock) return { result: null };
    tickets.set(cmd[1], clock + cmd[5]); return { result: 'OK' };
  };
  for (let index = 0; index < 12; index++) {
    assert.equal(await admitTsdRequest(command, `${index % 2 ? 'launches' : 'missions'}:${index}`), true);
    clock += 1000;
  }
  assert.equal(await admitTsdRequest(command, 'restarted-worker'), false);
  assert.equal(tickets.size, 12);
  clock = now + 3600_000;
  assert.equal(await admitTsdRequest(command, 'after-first-expiry'), true);
});

test('Redis budget errors fail closed and exhausted tickets never call provider or rewrite cache', async () => {
  await assert.rejects(admitTsdRequest(async () => { throw new Error('Redis down'); }, 'synthetic'));
  let calls = 0, writes = 0;
  const result = await seedSpace({ names: ['missions'], now, lock: async () => true, unlock: async () => {},
    command: async cmd => ({ result: cmd[1].startsWith('space:attempt:') ? 'OK' : null }),
    fetchDataset: async () => { calls++; }, publish: async () => { writes++; } });
  assert.equal(result[0].status, 'provider-budget');
  assert.equal(calls, 0);
  assert.equal(writes, 0);
});
