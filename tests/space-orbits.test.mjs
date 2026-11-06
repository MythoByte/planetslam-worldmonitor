import { test } from 'node:test';
import assert from 'node:assert/strict';
import { json2satrec, propagate } from 'satellite.js';
import { ORBIT_GROUPS, ORBIT_INTERVAL_MS, ORBIT_FETCH_MAX_AGE_MS, ORBIT_ELEMENT_MAX_AGE_MS, normalizeOrbitObject, projectOrbitCatalog, orbitGroupKey } from '../api/_space-orbits.js';
import { normalizeOrbitGroup, fetchOrbitGroup, seedOrbitCatalog } from '../scripts/_space-orbits.mjs';
import { spaceEnvelope } from '../api/_space-data.js';

const now = Date.parse('2026-11-06T15:00:00Z');
const omm = (overrides = {}) => ({ OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-11-06T12:00:00.000000', NORAD_CAT_ID: 25544,
  MEAN_MOTION: 15.5, ECCENTRICITY: 0.0004, INCLINATION: 51.64, RA_OF_ASC_NODE: 123.2, ARG_OF_PERICENTER: 30, MEAN_ANOMALY: 45,
  EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999, REV_AT_EPOCH: 10000, BSTAR: 0.00003, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0, ...overrides });
const catalog = (groups, items) => ({ groups, items });
const group = (id, fetchedAt = now, totalCount = 1) => ({ id, fetchedAt, totalCount, truncated: false });

test('GP JSON normalizes to installed satellite.js OMM input including six/nine digit IDs', () => {
  const record = normalizeOrbitObject(omm({ NORAD_CAT_ID: 100001 }), ['stations'], now);
  assert.equal(record.noradId, '100001');
  assert.equal(record.omm.EPOCH, '2026-11-06T12:00:00.000Z');
  const position = propagate(json2satrec(record.omm), new Date(now)).position;
  assert.ok(position && Number.isFinite(position.x));
  assert.equal(normalizeOrbitObject(omm({ NORAD_CAT_ID: 799500001 }), ['science'], now).noradId, '799500001');
});

test('malformed elements, non-SGP4 frames, impossible orbits and stale/future epochs are rejected', () => {
  for (const override of [{ MEAN_MOTION: 0 }, { ECCENTRICITY: 1 }, { INCLINATION: 181 }, { BSTAR: null }, { MEAN_MOTION_DOT: [] },
    { NORAD_CAT_ID: 0 }, { EPHEMERIS_TYPE: 2 }, { REF_FRAME: 'J2000' }, { TIME_SYSTEM: 'TAI' }, { CENTER_NAME: 'MARS' }, { MEAN_ELEMENT_THEORY: 'OTHER' },
    { EPOCH: 'bad' }, { EPOCH: new Date(now - ORBIT_ELEMENT_MAX_AGE_MS - 1).toISOString() }, { EPOCH: new Date(now + 2 * 86400_000).toISOString() }]) {
    assert.equal(normalizeOrbitObject(omm(override), ['stations'], now), null, JSON.stringify(override));
  }
});

test('elements older than48h are explicitly stale, rather than refreshed by HTTP fetch', () => {
  const raw = omm({ EPOCH: new Date(now - 3 * 86400_000).toISOString() });
  const item = normalizeOrbitObject(raw, ['stations'], now);
  assert.equal(item.elementStatus, 'stale');
  const result = projectOrbitCatalog(catalog([group('stations')], [item]), now);
  assert.equal(result.data.groups.find(g => g.id === 'stations').status, 'stale');
});

test('all-invalid nonempty provider data fails; a valid empty group stays distinguishable', () => {
  assert.throws(() => normalizeOrbitGroup([{ error: 'bad' }], 'stations', now));
  assert.throws(() => normalizeOrbitGroup({ error: 'quota' }, 'stations', now));
  const empty = normalizeOrbitGroup([], 'stations', now);
  const projected = projectOrbitCatalog(catalog([empty], []), now);
  assert.equal(projected.data.groups.find(g => g.id === 'stations').status, 'fresh');
  assert.equal(projected.data.groups.find(g => g.id === 'weather').status, 'unavailable');
  assert.equal(projected.status, 'stale');
  assert.equal(projected.data.complete, false);
});

test('malformed cached containers/counts never become fresh empty groups', () => {
  const zeroGroups = Object.keys(ORBIT_GROUPS).map(id => group(id, now, 0));
  assert.equal(projectOrbitCatalog({ groups: zeroGroups, items: null }, now).status, 'unavailable');
  assert.equal(projectOrbitCatalog({ groups: {}, items: [] }, now).status, 'unavailable');
  const malformed = projectOrbitCatalog({ groups: [{ ...group('stations'), totalCount: '1' }], items: [normalizeOrbitObject(omm(), ['stations'], now)] }, now);
  assert.equal(malformed.status, 'unavailable');
  assert.equal(malformed.data.items.length, 0);
});

test('catalog deduplicates by NORAD, merges groups and selects newest elements', () => {
  const stations = normalizeOrbitObject(omm(), ['stations'], now);
  const science = normalizeOrbitObject(omm({ EPOCH: '2026-11-06T13:00:00Z' }), ['science'], now);
  const projected = projectOrbitCatalog(catalog([group('stations'), group('science')], [stations, science]), now);
  assert.equal(projected.data.items.length, 1);
  assert.deepEqual(projected.data.items[0].groups, ['stations', 'science']);
  assert.equal(projected.data.items[0].epoch, Date.parse('2026-11-06T13:00:00Z'));
});

test('expired group fetches remove only their membership, with no original-clock renewal', () => {
  const item = normalizeOrbitObject(omm(), ['stations', 'science'], now);
  const expiredAt = now - ORBIT_FETCH_MAX_AGE_MS - 1;
  const projected = projectOrbitCatalog(catalog([group('stations', expiredAt), group('science')], [item]), now);
  assert.deepEqual(projected.data.items[0].groups, ['science']);
  assert.equal(projected.data.groups.find(g => g.id === 'stations').fetchedAt, expiredAt);
  assert.equal(projected.data.groups.find(g => g.id === 'stations').status, 'unavailable');
});

test('read-time element expiry cannot become a confirmed empty group', () => {
  const item = normalizeOrbitObject(omm(), ['stations'], now);
  const future = now + ORBIT_ELEMENT_MAX_AGE_MS + 1;
  const result = projectOrbitCatalog(catalog([group('stations', future)], [item]), future);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.data.items.length, 0);
  assert.match(result.data.groups[0].message, /No usable orbital/);
});

test('bounded Starlink sample exposes source count and truncation', () => {
  const raw = Array.from({ length: ORBIT_GROUPS.starlink.limit + 1 }, (_, i) => omm({ NORAD_CAT_ID: 100000 + i, OBJECT_NAME: `STARLINK-${i}` }));
  const result = normalizeOrbitGroup(raw, 'starlink', now);
  assert.equal(result.items.length, ORBIT_GROUPS.starlink.limit);
  assert.equal(result.totalCount, raw.length);
  assert.equal(result.truncated, true);
  const projected = projectOrbitCatalog(catalog([result], result.items), now);
  assert.equal(projected.data.complete, false);
});

test('fixed JSON provider request rejects excess response bytes and unsupported groups', async () => {
  let called;
  const fetchFn = async (url, options) => { called = { url, options }; return Response.json([omm()]); };
  assert.equal((await fetchOrbitGroup('stations', { now, fetchFn })).items.length, 1);
  assert.match(called.url, /GROUP=stations&FORMAT=JSON$/);
  assert.equal(called.options.redirect, 'error');
  await assert.rejects(fetchOrbitGroup('invalid', { now, fetchFn }));
  await assert.rejects(fetchOrbitGroup('starlink', { now, fetchFn: async () => new Response('[]', { headers: { 'content-length': '12000001' } }) }), /exceeds limit/);
});

test('durable per-group admission skips upstream work across restarts', async () => {
  const commands = [], writes = [];
  let requests = 0;
  const snapshot = normalizeOrbitGroup([omm()], 'stations', now - 1000);
  const response = await seedOrbitCatalog({ now, command: async cmd => {
    commands.push(cmd);
    return { result: cmd[0] === 'GET' && cmd[1] === orbitGroupKey('stations') ? JSON.stringify(snapshot) : null };
  }, publish: async payload => writes.push(payload), fetchGroup: async () => { requests++; } });
  assert.equal(requests, 0);
  assert.equal(writes.length, 0);
  assert.equal(response.data.items.length, 1);
  assert.equal(response.fetchedAt, now - 1000);
  assert.ok(commands.filter(cmd => cmd[0] === 'SET').every(cmd => cmd.includes('NX') && cmd[5] === ORBIT_INTERVAL_MS));
});

test('failed group fetch preserves last-good source timestamp and publishes explicit partial health', async () => {
  const snapshot = normalizeOrbitGroup([omm()], 'stations', now - 3600_000);
  const writes = [];
  const response = await seedOrbitCatalog({ now, command: async cmd => ({ result: cmd[0] === 'SET' ? 'OK'
    : cmd[1] === orbitGroupKey('stations') ? JSON.stringify(snapshot) : null }),
  publish: async payload => writes.push(payload), fetchGroup: async () => { throw new Error('provider blocked'); } });
  assert.equal(writes.length, 0);
  assert.equal(response.fetchedAt, snapshot.fetchedAt);
  const stations = response.data.groups.find(g => g.id === 'stations');
  assert.equal(stations.status, 'stale');
  assert.equal(stations.refreshFailed, true);
  const read = spaceEnvelope('orbits', { dataset: 'orbits', fetchedAt: now, data: response.data }, now);
  assert.equal(read.status, 'stale');
  assert.equal(read.fetchedAt, snapshot.fetchedAt);
  assert.equal(read.data.items.length, 1);
});

test('all missing/failed groups do not publish a fresh empty orbital catalog', async () => {
  const writes = [];
  await assert.rejects(seedOrbitCatalog({ now, command: async cmd => ({ result: cmd[0] === 'SET' ? 'OK' : null }),
    publish: async payload => writes.push(payload), fetchGroup: async () => { throw new Error('blocked'); } }), /No usable orbital/);
  assert.equal(writes.length, 0);
  const missing = spaceEnvelope('orbits', null, now);
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.data.groups.length, 5);
  assert.ok(missing.data.groups.every(g => g.status === 'unavailable'));
});

test('durable failure marker survives a subsequent cooldown tick without renewing last-good source time', async () => {
  const snapshot = normalizeOrbitGroup([omm()], 'stations', now - 3600_000);
  const stored = new Map([[orbitGroupKey('stations'), JSON.stringify(snapshot)]]);
  const admissions = new Set();
  const command = async cmd => {
    if (cmd[0] === 'GET') return { result: stored.get(cmd[1]) ?? null };
    if (cmd[0] === 'SET' && cmd.includes('NX')) {
      if (admissions.has(cmd[1])) return { result: null };
      admissions.add(cmd[1]); return { result: 'OK' };
    }
    if (cmd[0] === 'SET') { stored.set(cmd[1], cmd[2]); return { result: 'OK' }; }
    return { result: 1 };
  };
  let requests = 0;
  const opts = { now, command, publish: async () => {}, fetchGroup: async () => { requests++; throw new Error('provider outage'); } };
  const first = await seedOrbitCatalog(opts);
  const second = await seedOrbitCatalog({ ...opts, now: now + 60_000 });
  assert.equal(requests, 5);
  for (const response of [first, second]) {
    const wire = spaceEnvelope('orbits', { dataset: 'orbits', data: response.data, fetchedAt: now }, now + 60_000);
    assert.equal(wire.status, 'stale');
    assert.equal(wire.data.groups[0].refreshFailed, true);
    assert.equal(wire.fetchedAt, snapshot.fetchedAt);
  }
  assert.equal(JSON.parse(stored.get(orbitGroupKey('stations'))).fetchedAt, snapshot.fetchedAt);
});

test('a complete successful refresh publishes each group with bounded data+metadata TTL', async () => {
  const writes = [];
  const response = await seedOrbitCatalog({ now, command: async cmd => ({ result: cmd[0] === 'SET' ? 'OK' : null }),
    publish: async payload => writes.push(payload), fetchGroup: async id => normalizeOrbitGroup([omm({ NORAD_CAT_ID: 100000 + Object.keys(ORBIT_GROUPS).indexOf(id) })], id, now) });
  assert.equal(writes.length, 5);
  assert.ok(writes.every(write => write.ttlSeconds === ORBIT_FETCH_MAX_AGE_MS / 1000 && write.fetchedAt === now));
  assert.equal(response.data.complete, true);
  assert.equal(response.data.items.length, 5);
});
