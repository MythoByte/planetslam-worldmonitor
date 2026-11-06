import assert from 'node:assert/strict';
import test from 'node:test';
import { eciToGeodetic, gstime, degreesLat, degreesLong, twoline2satrec, propagate } from 'satellite.js';
import { calculateSpaceOrbitSnapshot, prepareSpaceOrbits, spaceOmmEpoch, splitSpaceGroundTrack, spaceOrbitGroupStatus, publishSpaceOrbitSnapshot, getPublishedSpaceOrbitSnapshot, emptySpaceOrbitSnapshot, SPACE_ORBIT_EVENT, MAX_SPACE_ORBIT_MARKERS, SPACE_ORBIT_MAX_AGE_MS } from '../src/services/space-orbits';
import type { OrbitCatalogData, OrbitObject, OrbitGroupHealth, SpaceOmmRecord } from '../src/types/space';

// Vallado SGP4 verification satellite00005, epoch2000-06-27T18:50:19.733568 UTC.
// Published reference ECI at epoch:7022.46529266,-1400.08296755,0.03995155 km.
// Reference: https://celestrak.org/publications/AIAA/2006-6753/
const epoch = Date.UTC(2000, 5, 27, 18, 50, 19, 733);
const omm: SpaceOmmRecord = {
  OBJECT_NAME: 'VANGUARD 1', OBJECT_ID: '1958-002B', EPOCH: '2000-06-27T18:50:19.733568',
  NORAD_CAT_ID: 5, MEAN_MOTION: 10.82419157, ECCENTRICITY: 0.1859667,
  INCLINATION: 34.2682, RA_OF_ASC_NODE: 348.7242, ARG_OF_PERICENTER: 331.7664,
  MEAN_ANOMALY: 19.3264, BSTAR: 0.000028098, MEAN_MOTION_DOT: 0.00000023,
  MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 475, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', REV_AT_EPOCH: 41366,
};
const item: OrbitObject = { noradId: '5', name: omm.OBJECT_NAME, objectId: omm.OBJECT_ID, epoch, groups: ['science'], omm, elementStatus: 'fresh' };
const source: OrbitGroupHealth = { id: 'science', label: 'Science', providerGroup: 'science', sourceUrl: 'https://celestrak.org/', status: 'fresh', fetchedAt: epoch, objectCount: 1, totalCount: 1, truncated: false };
const catalog = (items: OrbitObject[] = [item], groups: OrbitGroupHealth[] = [source]): OrbitCatalogData => ({ items, groups, complete: true });
const snapshotOptions = { selectedId: '5', group: 'science' as const, now: new Date(epoch) };

function close(actual: number, expected: number, tolerance: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}

test('OMM SGP4 agrees with Vallado reference and independent TLE ingestion', async () => {
  const prepared = await prepareSpaceOrbits(catalog(), epoch);
  assert.equal(prepared.length, 1);
  const snapshot = calculateSpaceOrbitSnapshot(prepared, snapshotOptions);
  assert.ok(snapshot.selected);
  const reference = eciToGeodetic({ x: 7022.46529266, y: -1400.08296755, z: 0.03995155 }, gstime(new Date(epoch)));
  close(snapshot.selected.latitude, degreesLat(reference.latitude), 0.0001, 'reference latitude');
  close(snapshot.selected.longitude, degreesLong(reference.longitude), 0.0001, 'reference longitude');
  close(snapshot.selected.altitudeKm, reference.height, 0.01, 'reference altitude');
  close(snapshot.selected.velocityKmS, Math.hypot(1.893841015, 6.405893759, 4.534807250), 0.00001, 'reference speed');

  const tle = twoline2satrec('1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753', '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667');
  const tlePosition = propagate(tle, new Date(epoch));
  assert.ok(tlePosition);
  const tleGeo = eciToGeodetic(tlePosition.position, gstime(new Date(epoch)));
  // JSON2satrec uses Date millisecond precision; TLE preserves submillisecond epoch digits.
  close(snapshot.selected.longitude, degreesLong(tleGeo.longitude), 0.0001, 'TLE longitude');
  close(snapshot.selected.altitudeKm, tleGeo.height, 0.01, 'TLE altitude');
  assert.ok(snapshot.groundTracks.length >= 2);
  assert.strictEqual(calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, now: new Date(epoch + 1000) }).groundTracks, snapshot.groundTracks, 'only selected track is cached perminute');
});

test('OMM epochs are explicitly UTC and malformed calendar dates are rejected', () => {
  assert.equal(spaceOmmEpoch('2000-06-27T18:50:19.733568'), epoch);
  assert.equal(spaceOmmEpoch('2000-06-27T18:50:19.733568Z'), epoch);
  assert.equal(spaceOmmEpoch('2026-02-31T00:00:00'), null);
  assert.equal(spaceOmmEpoch('2026-11-06'), null);
  assert.equal(spaceOmmEpoch('2026-11-06T00:00:00+05:00'), null);
});

test('malformed, mismatched, expired and implausibly future OMM sets never become map positions', async () => {
  const bad = [
    { ...item, omm: { ...omm, ECCENTRICITY: 1 } },
    { ...item, omm: { ...omm, MEAN_MOTION: NaN } },
    { ...item, noradId: '123' },
    { ...item, epoch: epoch + 10_000 },
  ];
  assert.deepEqual(await prepareSpaceOrbits(catalog(bad), epoch), []);
  assert.deepEqual(await prepareSpaceOrbits(catalog(), epoch + SPACE_ORBIT_MAX_AGE_MS + 1), []);
  assert.deepEqual(await prepareSpaceOrbits(catalog(), epoch - 25 * 60 * 60_000), []);
  const prepared = await prepareSpaceOrbits(catalog(), epoch);
  const expired = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, now: new Date(epoch + SPACE_ORBIT_MAX_AGE_MS + 1) });
  assert.equal(expired.selected, null);
  assert.deepEqual(expired.positions, []);
  assert.deepEqual(expired.groundTracks, []);
});

test('source group expiry removes only expired memberships, then clears selected when all sources expire', async () => {
  const old = { ...source, fetchedAt: epoch - 47 * 60 * 60_000 };
  const weather: OrbitGroupHealth = { ...source, id: 'weather' };
  const prepared = await prepareSpaceOrbits(catalog([{ ...item, groups: ['science', 'weather'] }], [old, weather]), epoch);
  const later = new Date(epoch + 2 * 60 * 60_000);
  const selected = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, now: later });
  assert.ok(selected.selected, 'fresh weather source preserves selected satellite');
  const expiredGroup = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, selectedId: '', now: later });
  assert.equal(expiredGroup.positions.length, 0, 'expired science membership cannot borrow weather freshness');
  const freshGroup = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, group: 'weather', now: later });
  assert.equal(freshGroup.positions.length, 1);
  const expiredAll = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, now: new Date(epoch + 49 * 60 * 60_000) });
  assert.equal(expiredAll.selected, null);
  assert.equal(expiredAll.positions.length, 0);
  assert.equal(spaceOrbitGroupStatus(old, later.getTime()), 'unavailable');
  assert.equal(spaceOrbitGroupStatus(weather, later.getTime()), 'fresh');
});

test('group markers are bounded while selection outside group is retained first', async () => {
  const records = Array.from({ length: 500 }, (_, index) => ({ ...item, noradId: String(index + 1), omm: { ...omm, NORAD_CAT_ID: index + 1 }, groups: [index === 499 ? 'stations' as const : 'science' as const] }));
  const stations: OrbitGroupHealth = { ...source, id: 'stations' };
  const prepared = await prepareSpaceOrbits(catalog(records, [source, stations]), epoch);
  const snapshot = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, selectedId: '500' });
  assert.equal(snapshot.positions.length, MAX_SPACE_ORBIT_MARKERS);
  assert.equal(snapshot.totalCount, 500);
  assert.equal(snapshot.positions[0].noradId, '500');
  assert.equal(snapshot.selected?.noradId, '500');
  const onlySelected = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, selectedId: '500', includeGroup: false });
  assert.equal(onlySelected.positions.length, 1);
});

test('dateline crossings split at interpolated boundaries in both directions and invalid samples form gaps', () => {
  const east = splitSpaceGroundTrack([[179, 10, 400], [-179, 12, 420]]);
  assert.deepEqual(east, [[[179, 10, 400], [180, 11, 410]], [[-180, 11, 410], [-179, 12, 420]]]);
  const west = splitSpaceGroundTrack([[-179, 10, 400], [179, 12, 420]]);
  assert.deepEqual(west, [[[-179, 10, 400], [-180, 11, 410]], [[180, 11, 410], [179, 12, 420]]]);
  const gaps = splitSpaceGroundTrack([[1, 1, 400], [2, 2, 400], [NaN, NaN, NaN], [10, 10, 400], [11, 11, 400]]);
  assert.equal(gaps.length, 2);
  for (const segment of [...east, ...west, ...gaps]) for (let index = 1; index < segment.length; index++) assert.ok(Math.abs(segment[index][0] - segment[index - 1][0]) <= 180);
});


test('aging elements stay explicitly stale even when the provider was just refreshed', async () => {
  const now = epoch + 50 * 60 * 60_000;
  const prepared = await prepareSpaceOrbits(catalog([item], [{ ...source, fetchedAt: now }]), now);
  const snapshot = calculateSpaceOrbitSnapshot(prepared, { ...snapshotOptions, now: new Date(now) });
  assert.ok(snapshot.selected);
  assert.equal(snapshot.selected.elementStatus, 'stale');
  assert.equal(snapshot.selected.epoch, epoch);
});

test('publishing an unavailable/destroyed selection clears retained map state and notifies subscribers', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  const values: unknown[] = [];
  target.addEventListener(SPACE_ORBIT_EVENT, event => values.push((event as CustomEvent).detail));
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
  try {
    const selection = { ...emptySpaceOrbitSnapshot(epoch), selectedId: '5' };
    publishSpaceOrbitSnapshot(selection);
    assert.strictEqual(getPublishedSpaceOrbitSnapshot(), selection);
    const cleared = emptySpaceOrbitSnapshot(epoch + 1);
    publishSpaceOrbitSnapshot(cleared);
    assert.strictEqual(getPublishedSpaceOrbitSnapshot(), cleared);
    assert.deepEqual(getPublishedSpaceOrbitSnapshot().positions, []);
    assert.deepEqual(getPublishedSpaceOrbitSnapshot().groundTracks, []);
    assert.deepEqual(values, [selection, cleared]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});


test('exact +180/-180 samples retain finite seam segments without zero-division', () => {
  const segments = splitSpaceGroundTrack([[179, 0, 400], [180, 1, 400], [-180, 2, 400], [-179, 3, 400]]);
  assert.equal(segments.length, 2);
  for (const segment of segments) {
    for (const point of segment) assert.ok(point.every(Number.isFinite));
    for (let index = 1; index < segment.length; index++) assert.ok(Math.abs(segment[index][0] - segment[index - 1][0]) <= 180);
  }
});
