import assert from 'node:assert/strict';
import test from 'node:test';
import { ecfToLookAngles, eciToEcf, eciToGeodetic, gstime, propagate } from 'satellite.js';
import { calculateMoonPhase, calculateSolarPosition, observerSunElevation, satelliteIllumination, predictSpacePasses, validateSpaceObserver } from '../src/services/space-observing';
import { prepareSpaceOrbits } from '../src/services/space-orbits';
import type { OrbitCatalogData, OrbitGroupHealth, SpaceOmmRecord } from '../src/types/space';
import type { PreparedSpaceOrbit } from '../src/types/space-orbits';
import type { SpaceObserver } from '../src/types/space-observing';

const now = new Date('2026-11-06T12:00:00Z');
const observer: SpaceObserver = { latitude: 40.7128, longitude: -74.006, altitudeM: 10 };
const DEG = Math.PI / 180;

async function fixture(at = now, groupExtras: Partial<OrbitGroupHealth> = {}): Promise<PreparedSpaceOrbit[]> {
  const omm: SpaceOmmRecord = {
    OBJECT_NAME: 'ISS fixture', OBJECT_ID: '1998-067A', EPOCH: at.toISOString(), NORAD_CAT_ID: 25544,
    MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.64, RA_OF_ASC_NODE: 60,
    ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 270, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001,
    MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999,
  };
  const data: OrbitCatalogData = {
    items: [{ noradId: '25544', name: 'ISS fixture', objectId: '1998-067A', epoch: at.getTime(), groups: ['stations'], omm, elementStatus: 'fresh' }],
    groups: [{ id: 'stations', label: 'Stations', providerGroup: 'stations', sourceUrl: 'https://celestrak.org/', status: 'fresh', fetchedAt: at.getTime(), objectCount: 1, totalCount: 1, truncated: false, ...groupExtras }],
    complete: true,
  };
  return prepareSpaceOrbits(data, at.getTime());
}

function elevation(entry: PreparedSpaceOrbit, observer: SpaceObserver, at: number): number {
  const value = propagate({ ...entry.satrec }, new Date(at));
  assert.ok(value);
  return ecfToLookAngles({ latitude: observer.latitude * DEG, longitude: observer.longitude * DEG, height: observer.altitudeM / 1000 }, eciToEcf(value.position, gstime(new Date(at)))).elevation / DEG;
}

let cachedFixture: PreparedSpaceOrbit[];
let cachedPrediction: Awaited<ReturnType<typeof predictSpacePasses>>;
async function referencePrediction() {
  cachedFixture ??= await fixture();
  cachedPrediction ??= await predictSpacePasses(cachedFixture, { observer, ids: ['25544'], now });
  return cachedPrediction;
}

test('observer coordinates require explicit finite numbers including real zero coordinates', () => {
  assert.deepEqual(validateSpaceObserver({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0, altitudeM: 0 });
  assert.equal(validateSpaceObserver(null), null);
  assert.equal(validateSpaceObserver({ latitude: '40', longitude: -74 }), null);
  assert.equal(validateSpaceObserver({ latitude: 91, longitude: 0 }), null);
  assert.equal(validateSpaceObserver({ latitude: 0, longitude: Infinity }), null);
  assert.equal(validateSpaceObserver({ latitude: 0, longitude: 181 }), null);
  assert.equal(validateSpaceObserver({ latitude: 0, longitude: 0, altitudeM: 20_000 }), null);
});

test('Moon approximation agrees with USNO2026 primary phase reference times', () => {
  // Official UT references: https://aa.usno.navy.mil/calculated/moon/phases?date=2025-11-05&format=p&nump=50&submit=Get+Data
  const references = [
    { at: '2026-01-03T10:03:00Z', phase: 'Full Moon', fraction: 0.5, illumination: 1 },
    { at: '2026-01-10T15:48:00Z', phase: 'Last Quarter', fraction: 0.75, illumination: 0.5 },
    { at: '2026-01-18T19:52:00Z', phase: 'New Moon', fraction: 0, illumination: 0 },
    { at: '2026-01-26T04:47:00Z', phase: 'First Quarter', fraction: 0.25, illumination: 0.5 },
  ];
  for (const reference of references) {
    const phase = calculateMoonPhase(new Date(reference.at));
    assert.equal(phase.phaseName, reference.phase);
    const fractionError = Math.abs(phase.phaseFraction - reference.fraction);
    assert.ok(Math.min(fractionError, 1 - fractionError) < 0.002);
    assert.ok(Math.abs(phase.illumination - reference.illumination) < 0.01);
    assert.equal(phase.model, 'approximate');
  }
  assert.throws(() => calculateMoonPhase(new Date(NaN)), RangeError);
});

test('solar position agrees with NREL SPA example within lowprecision model tolerance', () => {
  // NREL/TP-560-34302, example2003-10-17T19:30:30UT: RA202.227407°,declination-9.31434°,apparent elevation39.888378°.
  // https://nrel.gov/docs/fy08osti/34302.pdf. Elevation tolerance includes omitted atmospheric refraction.
  const date = new Date('2003-10-17T19:30:30Z');
  const sun = calculateSolarPosition(date);
  assert.ok(Math.abs(sun.rightAscensionDeg - 202.227407) < 0.03);
  assert.ok(Math.abs(sun.declinationDeg + 9.31434) < 0.03);
  assert.ok(Math.abs(observerSunElevation({ latitude: 39.742476, longitude: -105.1786, altitudeM: 1830 }, date) - 39.888378) < 0.04);
});

test('Earth occultation distinguishes sunlit, umbra and finite-disk penumbra geometry', () => {
  const solar = calculateSolarPosition(now).vectorKm;
  const distance = Math.hypot(solar.x, solar.y, solar.z);
  const unit = { x: solar.x / distance, y: solar.y / distance, z: solar.z / distance };
  const at = (scale: number) => ({ x: unit.x * scale, y: unit.y * scale, z: unit.z * scale });
  assert.equal(satelliteIllumination(at(7000), now), 'sunlit');
  assert.equal(satelliteIllumination(at(-7000), now), 'umbra');
  const xy = Math.hypot(unit.x, unit.y);
  const perpendicular = { x: -unit.y / xy, y: unit.x / xy, z: 0 };
  const limb = Math.asin(6378.137 / 7000);
  const grazing = {
    x: 7000 * (-unit.x * Math.cos(limb) + perpendicular.x * Math.sin(limb)),
    y: 7000 * (-unit.y * Math.cos(limb) + perpendicular.y * Math.sin(limb)),
    z: 7000 * (-unit.z * Math.cos(limb)),
  };
  assert.equal(satelliteIllumination(grazing, now), 'penumbra');
  assert.equal(satelliteIllumination({ x: NaN, y: 0, z: 0 }, now), 'umbra');
});

test('SGP4 pass boundaries and refined peak agree with independent1second lookangle scan', async () => {
  const prediction = await referencePrediction();
  assert.ok(prediction.passes.length > 0);
  const pass = prediction.passes[0];
  assert.equal(pass.ongoing, false);
  assert.ok(pass.aosAt < pass.peakAt && pass.peakAt < pass.losAt);
  assert.ok(Math.abs(elevation(cachedFixture[0], observer, pass.aosAt)) < 0.05);
  assert.ok(Math.abs(elevation(cachedFixture[0], observer, pass.losAt)) < 0.05);
  let maxElevation = -90;
  let peakAt = 0;
  for (let at = pass.peakAt - 30_000; at <= pass.peakAt + 30_000; at += 1000) {
    const value = elevation(cachedFixture[0], observer, at);
    if (value > maxElevation) { maxElevation = value; peakAt = at; }
  }
  assert.ok(Math.abs(pass.maxElevationDeg - maxElevation) < 0.005);
  assert.ok(Math.abs(pass.peakAt - peakAt) < 1500);
  for (const azimuth of [pass.aosAzimuthDeg, pass.peakAzimuthDeg, pass.losAzimuthDeg]) assert.ok(azimuth >= 0 && azimuth < 360);
  assert.ok(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(pass.peakDirection));
});

test('visibility requires darkness AND sunlight and can occur away from peak elevation', async () => {
  const prediction = await referencePrediction();
  assert.ok(prediction.passes.some(pass => pass.observerSunElevationAtPeakDeg > -6 && !pass.visibleAtPeak), 'daylight passes remain geometric only');
  assert.ok(prediction.passes.some(pass => pass.observerSunElevationAtPeakDeg < -6 && !pass.satelliteSunlitAtPeak && !pass.visibleAtPeak), 'shadowed night passes are not peak-visible');
  const candidate = prediction.passes.find(pass => pass.visible);
  assert.ok(candidate);
  assert.ok(candidate.visibleWindows.length > 0);
  for (const window of candidate.visibleWindows) {
    const midpoint = Math.floor((window.startAt + window.endAt) / 2);
    const date = new Date(midpoint);
    const propagated = propagate({ ...cachedFixture[0].satrec }, date);
    assert.ok(propagated);
    assert.ok(observerSunElevation(observer, date) <= -6);
    assert.equal(satelliteIllumination(propagated.position, date), 'sunlit');
    assert.ok(elevation(cachedFixture[0], observer, midpoint) >= 9.99);
  }
});

test('grazing retained-elevation threshold uses refined peak rather than coarse samples', async () => {
  const reference = await referencePrediction();
  const first = reference.passes[0];
  const justBelow = await predictSpacePasses(cachedFixture, { observer, ids: ['25544'], now, minPeakElevationDeg: first.maxElevationDeg - 0.005 });
  const justAbove = await predictSpacePasses(cachedFixture, { observer, ids: ['25544'], now, minPeakElevationDeg: first.maxElevationDeg + 0.005 });
  assert.ok(justBelow.passes.some(pass => Math.abs(pass.aosAt - first.aosAt) < 1000));
  assert.ok(!justAbove.passes.some(pass => Math.abs(pass.aosAt - first.aosAt) < 1000));
});

test('already-overhead and source-limited passes are explicitly clipped', async () => {
  const prepared = await fixture();
  const propagated = propagate({ ...prepared[0].satrec }, now);
  assert.ok(propagated);
  const subpoint = eciToGeodetic(propagated.position, gstime(now));
  const underSatellite = { latitude: subpoint.latitude / DEG, longitude: subpoint.longitude / DEG, altitudeM: 0 };
  const limit = now.getTime() + 120_000;
  prepared[0].sourceGroups = prepared[0].sourceGroups.map(group => ({ ...group, expiresAt: limit }));
  const prediction = await predictSpacePasses(prepared, { observer: underSatellite, ids: ['25544'], now });
  const pass = prediction.passes[0];
  assert.ok(pass);
  assert.equal(pass.ongoing, true);
  assert.equal(pass.aosAt, now.getTime());
  assert.equal(pass.endsAfterWindow, true);
  assert.equal(pass.losAt, limit);
  assert.match(prediction.satellites[0].message ?? '', /expire/);
});

test('none, expired sources and aged elements have distinct outcomes', async () => {
  const prepared = await fixture();
  const none = await predictSpacePasses(prepared, { observer: { latitude: 90, longitude: 0, altitudeM: 0 }, ids: ['25544'], now });
  assert.equal(none.satellites[0].status, 'no-passes');
  assert.deepEqual(none.passes, []);
  const expired = await predictSpacePasses(prepared, { observer, ids: ['25544'], now: new Date(now.getTime() + 49 * 60 * 60_000) });
  assert.equal(expired.satellites[0].status, 'expired');
  assert.deepEqual(expired.passes, []);
  const aged = await fixture();
  aged[0].epoch = now.getTime() - 50 * 60 * 60_000;
  const stale = await predictSpacePasses(aged, { observer, ids: ['25544'], now });
  assert.ok(stale.passes.length);
  assert.ok(stale.passes.every(pass => pass.elementStatus === 'stale' && pass.sourceStatus === 'stale'));
});

test('unrelated aged group members do not stale a fresh selected satellite; refresh failures do', async () => {
  const partial = await fixture(now, { status: 'stale', refreshFailed: false });
  const fresh = await predictSpacePasses(partial, { observer, ids: ['25544'], now });
  assert.ok(fresh.passes.every(pass => pass.sourceStatus === 'fresh'));
  const failed = await fixture(now, { status: 'stale', refreshFailed: true });
  const stale = await predictSpacePasses(failed, { observer, ids: ['25544'], now });
  assert.ok(stale.passes.every(pass => pass.sourceStatus === 'stale'));
});

test('IDs/horizon are bounded and prediction yields for cancellation', async () => {
  const prepared = await fixture();
  const ids = ['25544', ...Array.from({ length: 20 }, (_, index) => String(index + 1))];
  const bounded = await predictSpacePasses(prepared, { observer, ids, now });
  assert.equal(bounded.processedCount, 10);
  assert.equal(bounded.truncated, true);
  const controller = new AbortController();
  const pending = predictSpacePasses(prepared, { observer, ids: ['25544'], now, horizonHours: 48, signal: controller.signal });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(predictSpacePasses(prepared, { observer: { latitude: 100, longitude: 0, altitudeM: 0 }, ids: ['25544'], now }), RangeError);
});

test('UTC prediction crosses year boundary without local calendar resets', async () => {
  const start = new Date('2026-12-31T23:55:00Z');
  const prepared = await fixture(start);
  const prediction = await predictSpacePasses(prepared, { observer, ids: ['25544'], now: start, horizonHours: 24 });
  assert.equal(prediction.windowEnd - prediction.windowStart, 24 * 60 * 60_000);
  assert.ok(prediction.passes.some(pass => new Date(pass.peakAt).getUTCFullYear() === 2027));
  assert.ok(prediction.passes.every(pass => pass.aosAt >= start.getTime() && pass.losAt <= prediction.windowEnd));
});

test('failed propagation is unavailable rather than a confirmed empty sky', async () => {
  const prepared = await fixture();
  prepared[0].satrec.ecco = 2;
  const prediction = await predictSpacePasses(prepared, { observer, ids: ['25544'], now });
  assert.equal(prediction.satellites[0].status, 'unavailable');
  assert.equal(prediction.satellites[0].sourceStatus, 'unavailable');
  assert.match(prediction.satellites[0].message ?? '', /Propagation failed/);
  assert.deepEqual(prediction.passes, []);
});
