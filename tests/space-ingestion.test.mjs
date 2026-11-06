import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPACE_DATASETS, spaceEnvelope, spaceKey } from '../api/_space-data.js';
import { normalizeApod, normalizeLaunches, normalizeAurora, normalizeNeo, normalizeWeather, fetchSpaceDataset, time } from '../scripts/_space-providers.mjs';
import { seedSpace } from '../scripts/seed-space.mjs';

const now = Date.now();
const snap = (dataset, data, fetchedAt = now, observedAt = now) => ({ dataset, data, fetchedAt, observedAt });

test('cache states distinguish fresh, delayed, expired, malformed, and future records', () => {
  const data = { items: [{ title: 'News' }] };
  assert.equal(spaceEnvelope('news', snap('news', data), now).status, 'fresh');
  assert.equal(spaceEnvelope('news', snap('news', data, now - 31 * 60_000), now).status, 'stale');
  assert.equal(spaceEnvelope('news', snap('news', data, now - 7 * 3600_000), now).data, null);
  assert.equal(spaceEnvelope('news', snap('news', { wrong: [] }), now).status, 'unavailable');
  assert.equal(spaceEnvelope('news', snap('news', data, now + 3600_000), now).status, 'unavailable');
  assert.equal(spaceEnvelope('news', null, now).status, 'unavailable');
});

test('a fresh fetch cannot hide expired aurora observations', () => {
  const data = { forecastAt: now, observationAt: now - 2 * 3600_000, points: [] };
  assert.equal(spaceEnvelope('aurora', snap('aurora', data, now, data.observationAt), now).status, 'unavailable');
});

test('APOD publication age survives fresh fetches and expires after two days', () => {
  const data = { items: [{ date: '2026-11-05', title: 'Picture' }] };
  assert.equal(spaceEnvelope('apod', snap('apod', data, now, now - 24 * 3600_000), now).status, 'fresh');
  assert.equal(spaceEnvelope('apod', snap('apod', data, now, now - 37 * 3600_000), now).status, 'stale');
  const expired = spaceEnvelope('apod', snap('apod', data, now, now - 49 * 3600_000), now);
  assert.equal(expired.status, 'unavailable');
  assert.equal(expired.data, null);
  assert.equal(spaceEnvelope('apod', snap('apod', data, now, null), now).status, 'unavailable');
});

test('cache-only launch read removes missions that passed since ingestion without changing its clock', () => {
  const data = { items: [{ id: 'past', net: now - 1000, status: 'Go for Launch' },
    { id: 'future-success', net: now + 1000, status: 'Launch Successful' }, { id: 'future', net: now + 1000, status: 'To Be Determined' }] };
  const fetchedAt = now - 60_000;
  const response = spaceEnvelope('launches', snap('launches', data, fetchedAt, null), now);
  assert.equal(response.status, 'fresh');
  assert.equal(response.fetchedAt, fetchedAt);
  assert.deepEqual(response.data.items.map(item => item.id), ['future']);
  assert.equal(data.items.length, 3);
  const later = spaceEnvelope('launches', snap('launches', data, fetchedAt, null), now + 2000);
  assert.deepEqual(later.data.items, []);
  assert.equal(later.status, 'fresh');
});

test('APOD supports video days, safe URLs, date order and third party credit', () => {
  const out = normalizeApod([{ date: '2026-11-05', title: 'Image', media_type: 'image', url: 'https://example.org/image.jpg', copyright: 'Photographer' },
    { date: '2026-11-06', title: 'Video', media_type: 'video', url: 'https://www.youtube.com/embed/example', thumbnail_url: 'https://example.org/thumb.jpg' },
    { date: '2026-11-07', title: 'Unsafe', media_type: 'image', url: 'javascript:alert(1)' }]);
  assert.equal(out.data.items[0].mediaType, 'video');
  assert.equal(out.data.items[1].credit, 'Photographer');
  assert.equal(out.data.items.length, 2);
  assert.throws(() => normalizeApod({ error: 'quota' }));
});

test('launch schedule preserves provider status and rejects fabricated empty success', () => {
  const result = normalizeLaunches({ results: [{ id: 'id', name: 'Falcon 9', net: '2026-11-07T12:00:00Z', status: { name: 'TBD' },
    launch_service_provider: { name: 'SpaceX' }, pad: { latitude: '28.5', longitude: '-80.5' }, vid_urls: [{ url: 'https://www.spacex.com/launches/' }] }] });
  assert.equal(result.data.items[0].status, 'TBD');
  assert.equal(result.data.items[0].latitude, 28.5);
  assert.throws(() => normalizeLaunches({ results: [] }));
  assert.deepEqual(normalizeLaunches({ count: 0, results: [] }).data.items, []);
});

test('upcoming launches exclude past and terminal records, even when the provider upcoming feed includes them', () => {
  const item = (id, delta, status) => ({ id, name: id, net: new Date(now + delta).toISOString(), status: { name: status } });
  const result = normalizeLaunches({ results: [item('past-success', -86400_000, 'Launch Successful'), item('past-scheduled', -60_000, 'Go for Launch'),
    item('future-failure', 3600_000, 'Launch Failure'), item('future-success', 3600_000, 'Launch Successful'), item('future-payload', 3600_000, 'Payload Deployed'),
    item('future-later', 7200_000, 'To Be Determined'), item('future-soon', 3600_000, 'Go for Launch')] }, now);
  assert.deepEqual(result.data.items.map(i => i.id), ['future-soon', 'future-later']);
});

test('launch requests use one bounded page and stable current-time filter', async () => {
  const calls = [];
  const result = await fetchSpaceDataset('launches', { now, launchKey: '', fetchFn: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json({ count: 0, results: [] });
  } });
  assert.deepEqual(result.data.items, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('limit'), '30');
  assert.equal(calls[0].url.searchParams.get('ordering'), 'net');
  assert.equal(calls[0].url.searchParams.get('net__gte'), new Date(Math.floor(now / 60_000) * 60_000).toISOString());
  assert.ok(!calls[0].options.headers.Authorization);
});

test('news uses the official working ESA TopNews feed and tolerates supplemental outages', async () => {
  const urls = [];
  const result = await fetchSpaceDataset('news', { now, fetchFn: async url => {
    urls.push(url);
    if (url.includes('spaceflightnewsapi')) return Response.json({ results: [{ id: 1, title: 'Mission', url: 'https://example.org/story', news_site: 'News', published_at: new Date(now).toISOString(), summary: 'Mission update', launches: [] }] });
    return new Response('', { status: 503 });
  } });
  assert.ok(urls.includes('https://www.esa.int/rssfeed/TopNews'));
  assert.equal(result.data.items.length, 1);
});

test('aurora normalizes longitude, retains intensity and rejects malformed grids', () => {
  const out = normalizeAurora({ 'Observation Time': '2026-11-06T12:00:00Z', 'Forecast Time': '2026-11-06T13:00:00Z', coordinates: [[250, 70, 80], [10, 10, 0]] });
  assert.deepEqual(out.data.points, [{ longitude: -110, latitude: 70, probability: 80 }]);
  assert.throws(() => normalizeAurora({ 'Observation Time': '2026-11-06T12:00:00Z', 'Forecast Time': '2026-11-06T13:00:00Z', coordinates: [['bad']] }));
});

test('NEO retains a classification without converting it into an impact prediction', () => {
  const raw = { element_count: 1, near_earth_objects: { '2026-11-06': [{ id: '123', name: 'Object', is_potentially_hazardous_asteroid: true,
    nasa_jpl_url: 'http://ssd.jpl.nasa.gov/example', estimated_diameter: { kilometers: { estimated_diameter_min: 0.1, estimated_diameter_max: 0.2 } },
    close_approach_data: [{ orbiting_body: 'Earth', epoch_date_close_approach: now, miss_distance: { kilometers: '1000000', lunar: '2.6' }, relative_velocity: { kilometers_per_second: '12.5' } }] }] } };
  const object = normalizeNeo(raw).data.items[0];
  assert.equal(object.potentiallyHazardous, true);
  assert.equal(object.velocityKmS, 12.5);
  assert.equal(object.url.startsWith('https:'), true);
  assert.throws(() => normalizeNeo({ near_earth_objects: {} }));
});

test('NOAA uses active replacement RTSW readings, keeps zero severity and Bz', () => {
  const out = normalizeWeather({ 0: { DateStamp: '2026-11-06', TimeStamp: '12:00:00', G: { Scale: '0' }, R: { Scale: '1' }, S: { Scale: '0' } } },
    [{ time_tag: '2026-11-06T12:00:00', estimated_kp: 2.3 }],
    [{ time_tag: '2026-11-06T12:00:00', active: false, proton_speed: 999, proton_density: 1 }, { time_tag: '2026-11-06T12:00:00', active: true, proton_speed: 450, proton_density: 4 }],
    [{ time_tag: '2026-11-06T12:00:00', active: true, bz_gsm: -3 }], []);
  assert.deepEqual(out.data.scales, { G: 0, R: 1, S: 0 });
  assert.equal(out.data.wind[0].speed, 450);
  assert.equal(out.data.wind[0].bz, -3);
  assert.throws(() => normalizeWeather({}, [], [], [], []));
});

test('NASA datasets fail without a key before making any request', async () => {
  let calls = 0;
  await assert.rejects(fetchSpaceDataset('neo', { nasaKey: '', fetchFn: async () => { calls++; } }), /NASA_API_KEY/);
  assert.equal(calls, 0);
});

test('date parser handles NOAA timestamps and HTTP Last-Modified', () => {
  assert.equal(time('2026-11-06 12:00:00'), time('2026-11-06T12:00:00Z'));
  assert.equal(time('Fri, 06 Nov 2026 12:00:00 GMT'), time('2026-11-06T12:00:00Z'));
});

test('seeder cooldown and held lock prevent provider calls', async () => {
  let calls = 0;
  const opts = { names: ['launches'], command: async () => ({ result: null }), lock: async () => true, unlock: async () => {}, fetchDataset: async () => { calls++; } };
  assert.equal((await seedSpace(opts))[0].status, 'cooldown');
  assert.equal((await seedSpace({ ...opts, lock: async () => false }))[0].status, 'locked');
  assert.equal(calls, 0);
});

test('failed provider preserves last-good cache and its clock; attempt is budgeted', async () => {
  const commands = [], writes = [];
  const results = await seedSpace({ names: ['launches'], now, command: async command => { commands.push(command); return { result: command[0] === 'EVAL' ? 1 : 'OK' }; },
    lock: async () => true, unlock: async () => {}, fetchDataset: async () => { throw new Error('upstream outage'); }, publish: async payload => writes.push(payload) });
  assert.equal(results[0].status, 'failed');
  assert.equal(writes.length, 0);
  assert.equal(commands[0][5], SPACE_DATASETS.launches.intervalMs);
  assert.ok(commands[0].includes('NX'));
});

test('successful seed atomically publishes bounded cache and companion metadata', async () => {
  const writes = [];
  const results = await seedSpace({ names: ['launches'], command: async command => ({ result: command[0] === 'EVAL' ? 1 : 'OK' }), lock: async () => true, unlock: async () => {},
    fetchDataset: async () => ({ data: { items: [] }, observedAt: null }), publish: async payload => writes.push(payload) });
  assert.equal(results[0].status, 'published');
  assert.equal(writes[0].key, spaceKey('launches'));
  assert.equal(writes[0].ttlSeconds, SPACE_DATASETS.launches.maxAgeMs / 1000);
  assert.equal(writes[0].recordCount, 0);
});
