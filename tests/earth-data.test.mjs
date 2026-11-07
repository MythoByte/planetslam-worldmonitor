import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EARTH_SOURCES, earthKey, earthEnvelope, projectEarthSource, normalizeAirQualityCache } from '../api/_earth-data.js';
import { seedEarth } from '../scripts/seed-earth.mjs';
import handler from '../api/earth.js';
const now = Date.now();
const event = (sourceId = 'nws', delta = 60_000) => ({ id: `${sourceId}:synthetic`, sourceId, title: 'Synthetic flood warning', kind: 'flood',
  latitude: 40, longitude: -80, region: 'North America', severity: 'moderate', status: 'Flood warning', mode: 'warning', observedAt: now - 1000,
  expiresAt: now + delta, url: 'https://example.org/synthetic', provider: 'Synthetic source', summary: 'Synthetic fixture' });
const snap = (sourceId, items, fetchedAt = now, observedAt = now) => ({ sourceId, dataset: EARTH_SOURCES[sourceId].dataset, fetchedAt, observedAt, data: { items } });

test('provider clocks are independent and unavailable sources cannot be hidden by a fresh source', () => {
  const snapshots = { nws: snap('nws', [event()]), gdacs: snap('gdacs', [event('gdacs')], now - 4 * 3600_000) };
  const result = earthEnvelope('alerts', snapshots, now);
  assert.equal(result.status, 'stale');
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.sources.find(row => row.id === 'nws').status, 'fresh');
  assert.equal(result.data.sources.find(row => row.id === 'gdacs').status, 'unavailable');
  assert.equal(result.data.sources.find(row => row.id === 'tsunami').status, 'unavailable');
  assert.equal(earthEnvelope('alerts', {}, now).status, 'unavailable');
});

test('cache reads remove expired warnings without moving timestamps', () => {
  const snapshot = snap('nws', [event('nws', -1), event('nws', 1000)]);
  assert.equal(projectEarthSource('nws', snapshot, now).items.length, 1);
  assert.equal(projectEarthSource('nws', snapshot, now + 1001).items.length, 0);
  assert.equal(projectEarthSource('nws', snapshot, now + 1001).fetchedAt, now);
  assert.equal(snapshot.data.items.length, 2);
});

test('malformed, future, delayed and expired cache states fail visibly', () => {
  assert.equal(projectEarthSource('nws', snap('nws', [event()], now + 3600_000), now).status, 'unavailable');
  assert.equal(projectEarthSource('nws', snap('nws', [{ ...event(), latitude: 200 }]), now).status, 'unavailable');
  assert.equal(projectEarthSource('nws', snap('nws', [event()], now - 11 * 60_000), now).status, 'stale');
  assert.equal(projectEarthSource('nws', snap('nws', [event()], now - 31 * 60_000), now).status, 'unavailable');
});

test('news groups exact normalized story titles without combining different dated developments', () => {
  const story = { id: 'a', sourceId: 'news-nasa', title: 'Synthetic Earth update', url: 'https://example.org/a?utm_source=feed',
    publisher: 'NASA', publishedAt: now, kind: 'weather', region: 'Global', official: true, summary: '' };
  const snapshots = { 'news-nasa': snap('news-nasa', [story]),
    'news-guardian': snap('news-guardian', [{ ...story, id: 'b', sourceId: 'news-guardian', url: 'https://example.org/b', official: false }]),
    'news-nhc': snap('news-nhc', [{ ...story, id: 'c', sourceId: 'news-nhc', publishedAt: now - 86400_000, url: 'https://example.org/c' }]) };
  const result = earthEnvelope('news', snapshots, now);
  assert.equal(result.data.items.length, 2);
  assert.equal(result.data.items[0].url, 'https://example.org/a');
  assert.deepEqual(result.data.items[0].relatedUrls, ['https://example.org/b']);
});

test('existing AQ cache filters stale observations and preserves observation clock', () => {
  const raw = { fetchedAt: now, stations: [{ city: 'Synthetic city', country_code: 'US', lat: 40, lng: -80, aqi: 80, pm25: 25,
    measured_at: now - 1000, source: 'OpenAQ' }, { city: 'Old city', lat: 40, lng: -80, aqi: 90, pm25: 30, measured_at: now - 6 * 3600_000 }] };
  const normalized = normalizeAirQualityCache(raw);
  assert.equal(normalized.data.items[0].observedAt, now - 1000);
  const out = earthEnvelope('airquality', { 'airquality-cache': raw }, now);
  assert.equal(out.status, 'fresh');
  assert.equal(out.data.items.length, 1);
  assert.equal(earthKey('airquality-cache'), 'climate:air-quality:v1');
  assert.equal(earthEnvelope('airquality', { 'airquality-cache': { ...raw, fetchedAt: now - 4 * 3600_000 } }, now).status, 'unavailable');
});

test('seeder cooldown, locks, validation and outages preserve last-good writes', async () => {
  let calls = 0;
  const commands = [], writes = [];
  const options = { names: ['nws'], now, command: async command => { commands.push(command); return { result: 'OK' }; },
    lock: async () => true, unlock: async () => {}, publish: async write => writes.push(write),
    fetchSource: async () => { calls++; return { data: { items: [event()] }, observedAt: now - 1000 }; } };
  assert.equal((await seedEarth({ ...options, lock: async () => false }))[0].status, 'locked');
  assert.equal((await seedEarth({ ...options, command: async () => ({ result: null }) }))[0].status, 'cooldown');
  assert.equal(calls, 0);
  assert.equal((await seedEarth(options))[0].status, 'published');
  assert.equal(writes[0].key, earthKey('nws'));
  assert.equal(writes[0].data.observedAt, now - 1000);
  assert.equal(writes[0].extra.schemaVersion, 1);
  assert.equal(commands[0][5], EARTH_SOURCES.nws.intervalMs);
  writes.length = 0;
  assert.equal((await seedEarth({ ...options, fetchSource: async () => { throw new Error('outage'); } }))[0].status, 'failed');
  assert.equal((await seedEarth({ ...options, fetchSource: async () => ({ data: { items: [{ ...event(), url: 'javascript:alert(1)' }] } }) }))[0].status, 'failed');
  assert.equal(writes.length, 0);
});

test('cache-only API validates dataset and method before touching storage', async () => {
  const prior = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No fetch expected'); };
  try {
    assert.equal((await handler(new Request('https://planetslam.com/api/earth?dataset=__proto__'))).status, 400);
    assert.equal((await handler(new Request('https://planetslam.com/api/earth', { method: 'POST' }))).status, 405);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = prior; }
});

test('API reads only selected source cache keys and never calls providers', async () => {
  const priorFetch = globalThis.fetch, priorUrl = process.env.UPSTASH_REDIS_REST_URL, priorToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://synthetic-redis.example.org'; process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-token';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, commands: JSON.parse(options.body) });
    return Response.json([{ result: JSON.stringify(snap('usgs', [{ ...event('usgs'), kind: 'earthquake' }])) }]);
  };
  try {
    const response = await handler(new Request('https://planetslam.com/api/earth?dataset=earthquakes'));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.items.length, 1);
    assert.deepEqual(calls, [{ url: 'https://synthetic-redis.example.org/pipeline', commands: [['GET', earthKey('usgs')]] }]);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = priorUrl;
    if (priorToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = priorToken;
  }
});
