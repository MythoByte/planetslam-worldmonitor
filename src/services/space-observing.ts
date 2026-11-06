import type { PreparedSpaceOrbit } from '@/types/space-orbits';
import type { MoonPhase, SolarPosition, SpaceObserver, SpacePassOptions, SpacePassPrediction, SpaceSatellitePrediction, SpaceVisibilityWindow } from '@/types/space-observing';
import { SPACE_ORBIT_FRESH_AGE_MS, SPACE_ORBIT_MAX_AGE_MS, SPACE_ORBIT_SOURCE_MAX_AGE_MS } from './space-orbits';

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
const EARTH_RADIUS_KM = 6378.137;
const SOLAR_RADIUS_KM = 696_340;
const AU_KM = 149_597_870.7;
const SYNODIC_MONTH_DAYS = 29.530588853;
const STEP_MS = 20_000;
const VISIBLE_STEP_MS = 5_000;
const MAX_SAMPLES = 200_000;
export const MAX_SPACE_PASS_SATELLITES = 10;
export const SPACE_VISIBLE_MIN_ELEVATION_DEG = 10;
export const SPACE_OBSERVER_DARKNESS_DEG = -6;

const clamp = (value: number, low = -1, high = 1) => Math.max(low, Math.min(high, value));
const angle = (value: number) => ((value % 360) + 360) % 360;
const sin = (value: number) => Math.sin(value * DEG);
const cos = (value: number) => Math.cos(value * DEG);
const dateMs = (date: Date) => {
  const at = date.getTime();
  if (!Number.isFinite(at) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2100) throw new RangeError('Observing calculations require a date from 1900 through 2100.');
  return at;
};

/** Coordinates must come from an explicit user choice; this never requests location. */
export function validateSpaceObserver(input: unknown): SpaceObserver | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<SpaceObserver>;
  const altitudeM = value.altitudeM ?? 0;
  if (typeof value.latitude !== 'number' || typeof value.longitude !== 'number' || typeof altitudeM !== 'number'
    || ![value.latitude, value.longitude, altitudeM].every(Number.isFinite)
    || value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180
    || altitudeM < -500 || altitudeM > 10_000) return null;
  return { latitude: value.latitude, longitude: value.longitude, altitudeM };
}

/**
 * USNO approximate solar coordinates, about 1 arcminute near J2000; geometric, no refraction.
 * Primary method: https://aa.usno.navy.mil/faq/sun_approx
 * Horizon transform: https://aa.usno.navy.mil/faq/alt_az
 */
export function calculateSolarPosition(now: Date): SolarPosition {
  const at = dateMs(now);
  const days = at / DAY_MS + 2440587.5 - 2451545;
  const anomaly = angle(357.529 + 0.98560028 * days);
  const meanLongitude = angle(280.459 + 0.98564736 * days);
  const longitude = angle(meanLongitude + 1.915 * sin(anomaly) + 0.020 * sin(2 * anomaly));
  const obliquity = 23.439 - 0.00000036 * days;
  const distanceAu = 1.00014 - 0.01671 * cos(anomaly) - 0.00014 * cos(2 * anomaly);
  const distanceKm = distanceAu * AU_KM;
  const x = distanceKm * cos(longitude);
  const y = distanceKm * cos(obliquity) * sin(longitude);
  const z = distanceKm * sin(obliquity) * sin(longitude);
  return {
    at, rightAscensionDeg: angle(Math.atan2(y, x) / DEG), declinationDeg: Math.asin(clamp(z / distanceKm)) / DEG,
    eclipticLongitudeDeg: longitude, distanceAu, vectorKm: { x, y, z },
  };
}

export function observerSunElevation(observer: SpaceObserver, now: Date): number {
  const solar = calculateSolarPosition(now);
  const days = solar.at / DAY_MS + 2440587.5 - 2451545;
  const hourAngle = angle(280.46061837 + 360.98564736629 * days + observer.longitude - solar.rightAscensionDeg);
  return Math.asin(clamp(sin(observer.latitude) * sin(solar.declinationDeg)
    + cos(observer.latitude) * cos(solar.declinationDeg) * cos(hourAngle))) / DEG;
}

/**
 * Low-precision lunar orbit plus solar perturbations; phase is geocentric.
 * Original algorithm: https://stjarnhimlen.se/comp/ppcomp.html sections 4, 6, 7, 9, 15.
 * Approximate age is phase-angle fraction times mean synodic month, not an event ephemeris.
 */
export function calculateMoonPhase(now = new Date()): MoonPhase {
  const at = dateMs(now);
  const days = (at - Date.UTC(1999, 11, 31)) / DAY_MS;
  const node = angle(125.1228 - 0.0529538083 * days);
  const inclination = 5.1454;
  const perigee = angle(318.0634 + 0.1643573223 * days);
  const anomaly = angle(115.3654 + 13.0649929509 * days);
  const eccentricity = 0.0549;
  let eccentricAnomaly = anomaly * DEG;
  for (let iteration = 0; iteration < 6; iteration++) eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - anomaly * DEG) / (1 - eccentricity * Math.cos(eccentricAnomaly));
  const xv = 60.2666 * (Math.cos(eccentricAnomaly) - eccentricity);
  const yv = 60.2666 * Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly);
  const trueAnomaly = Math.atan2(yv, xv) / DEG;
  const orbitAngle = trueAnomaly + perigee;
  let distance = Math.hypot(xv, yv);
  const x = distance * (cos(node) * cos(orbitAngle) - sin(node) * sin(orbitAngle) * cos(inclination));
  const y = distance * (sin(node) * cos(orbitAngle) + cos(node) * sin(orbitAngle) * cos(inclination));
  const z = distance * sin(orbitAngle) * sin(inclination);
  let longitude = Math.atan2(y, x) / DEG;
  let latitude = Math.atan2(z, Math.hypot(x, y)) / DEG;
  const sunAnomaly = angle(356.0470 + 0.9856002585 * days);
  const sunPerigee = angle(282.9404 + 0.0000470935 * days);
  const elongation = anomaly + perigee + node - sunAnomaly - sunPerigee;
  const argumentLatitude = anomaly + perigee;
  longitude += -1.274 * sin(anomaly - 2 * elongation) + 0.658 * sin(2 * elongation) - 0.186 * sin(sunAnomaly)
    - 0.059 * sin(2 * anomaly - 2 * elongation) - 0.057 * sin(anomaly - 2 * elongation + sunAnomaly)
    + 0.053 * sin(anomaly + 2 * elongation) + 0.046 * sin(2 * elongation - sunAnomaly)
    + 0.041 * sin(anomaly - sunAnomaly) - 0.035 * sin(elongation) - 0.031 * sin(anomaly + sunAnomaly)
    - 0.015 * sin(2 * argumentLatitude - 2 * elongation) + 0.011 * sin(anomaly - 4 * elongation);
  latitude += -0.173 * sin(argumentLatitude - 2 * elongation) - 0.055 * sin(anomaly - argumentLatitude - 2 * elongation)
    - 0.046 * sin(anomaly + argumentLatitude - 2 * elongation) + 0.033 * sin(argumentLatitude + 2 * elongation)
    + 0.017 * sin(2 * anomaly + argumentLatitude);
  distance += -0.58 * cos(anomaly - 2 * elongation) - 0.46 * cos(2 * elongation);
  const solar = calculateSolarPosition(now);
  const phaseFraction = angle(longitude - solar.eclipticLongitudeDeg) / 360;
  const angularSeparation = Math.acos(clamp(cos(latitude) * cos(longitude - solar.eclipticLongitudeDeg)));
  const moonDistanceKm = distance * EARTH_RADIUS_KM;
  const sunDistanceKm = solar.distanceAu * AU_KM;
  const phaseAngle = Math.atan2(sunDistanceKm * Math.sin(angularSeparation), moonDistanceKm - sunDistanceKm * Math.cos(angularSeparation));
  const phaseNames = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  return {
    at, phaseFraction, illumination: clamp((1 + Math.cos(phaseAngle)) / 2, 0, 1),
    phaseName: phaseNames[Math.floor(phaseFraction * 8 + 0.5) % 8]!,
    approximateAgeDays: phaseFraction * SYNODIC_MONTH_DAYS, waxing: phaseFraction < 0.5, model: 'approximate',
  };
}

/** Finite solar/Earth disks distinguish full sunlight, penumbra, and umbra. */
export function satelliteIllumination(position: { x: number; y: number; z: number }, now: Date): 'sunlit' | 'penumbra' | 'umbra' {
  const solar = calculateSolarPosition(now).vectorKm;
  const radius = Math.hypot(position.x, position.y, position.z);
  if (!Number.isFinite(radius) || radius <= EARTH_RADIUS_KM) return 'umbra';
  const toSun = { x: solar.x - position.x, y: solar.y - position.y, z: solar.z - position.z };
  const distance = Math.hypot(toSun.x, toSun.y, toSun.z);
  const separation = Math.acos(clamp((-position.x * toSun.x - position.y * toSun.y - position.z * toSun.z) / (radius * distance)));
  const earthAngle = Math.asin(clamp(EARTH_RADIUS_KM / radius));
  const sunAngle = Math.asin(clamp(SOLAR_RADIUS_KM / distance));
  if (separation >= earthAngle + sunAngle) return 'sunlit';
  return separation <= earthAngle - sunAngle ? 'umbra' : 'penumbra';
}

export function isSatelliteSunlit(position: { x: number; y: number; z: number }, now: Date): boolean {
  return satelliteIllumination(position, now) === 'sunlit';
}

interface PassSample { at: number; elevation: number; azimuth: number; sunElevation: number; sunlit: boolean; visible: boolean }
const direction = (azimuth: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(angle(azimuth) / 45) % 8]!;
const sourceQuality = (entry: PreparedSpaceOrbit, at: number): 'fresh' | 'stale' | 'unavailable' => {
  const groups = entry.sourceGroups.filter(group => group.expiresAt >= at);
  if (!groups.length) return 'unavailable';
  return groups.some(group => !group.refreshFailed && at - (group.fetchedAt ?? group.expiresAt - SPACE_ORBIT_SOURCE_MAX_AGE_MS) <= 12 * 60 * 60_000) ? 'fresh' : 'stale';
};
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Pass prediction cancelled', 'AbortError');
};

/**
 * Bounded local SGP4 planning predictions, never live telemetry or guaranteed visibility.
 * AOS/LOS: geometric 0° horizon; default retained peak >= 10°. Visible windows additionally
 * require elevation >= 10°, observer Sun <= -6°, and full satellite sunlight.
 * Atmosphere, terrain, cloud cover, brightness and maneuvers are not modeled.
 */
export async function predictSpacePasses(prepared: PreparedSpaceOrbit[], options: SpacePassOptions): Promise<SpacePassPrediction> {
  const observer = validateSpaceObserver(options.observer);
  if (!observer) throw new RangeError('Choose valid observer coordinates before predicting passes.');
  const now = options.now ?? new Date();
  const start = dateMs(now);
  const hours = options.horizonHours ?? 24;
  if (hours !== 24 && hours !== 48) throw new RangeError('Pass horizon must be 24 or 48 hours.');
  const minPeak = options.minPeakElevationDeg ?? 10;
  if (!Number.isFinite(minPeak) || minPeak < 0 || minPeak > 90) throw new RangeError('Minimum pass elevation must be 0 to 90 degrees.');
  checkAbort(options.signal);
  const ids = [...new Set(options.ids.filter(id => typeof id === 'string' && /^\d{1,9}$/.test(id)))];
  const selected = ids.slice(0, MAX_SPACE_PASS_SATELLITES);
  const end = start + hours * 60 * 60_000;
  const satellites: SpaceSatellitePrediction[] = [];
  if (!selected.length) return { generatedAt: start, windowStart: start, windowEnd: end, observer, satellites, passes: [], requestedCount: ids.length, processedCount: 0, truncated: ids.length > selected.length };
  const lib = await import('satellite.js');
  checkAbort(options.signal);
  const observerGd = { latitude: observer.latitude * DEG, longitude: observer.longitude * DEG, height: observer.altitudeM / 1000 };
  let samples = 0;
  let yieldedAt = 0;
  const checkpoint = async () => {
    checkAbort(options.signal);
    if (samples - yieldedAt >= 128) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      yieldedAt = samples;
      checkAbort(options.signal);
    }
  };
  for (const id of selected) {
    checkAbort(options.signal);
    const entry = prepared.find(candidate => candidate.item.noradId === id);
    const metadata: SpaceSatellitePrediction = {
      noradId: id, name: entry?.item.name ?? `NORAD ${id}`, status: 'unavailable', sourceStatus: 'unavailable',
      elementEpoch: entry?.epoch ?? null, elementStatus: null, sourceExpiresAt: null, passes: [],
    };
    satellites.push(metadata);
    if (!entry) { metadata.message = 'No usable orbital elements for this satellite.'; continue; }
    const sourceExpiresAt = Math.max(...entry.sourceGroups.map(group => group.expiresAt));
    metadata.sourceExpiresAt = Number.isFinite(sourceExpiresAt) ? sourceExpiresAt : null;
    const sourceStatus = sourceQuality(entry, start);
    const age = start - entry.epoch;
    if (!Number.isFinite(age) || age > SPACE_ORBIT_MAX_AGE_MS || age < -DAY_MS || sourceStatus === 'unavailable') {
      metadata.status = 'expired'; metadata.message = 'Source snapshot or orbital elements have expired.'; continue;
    }
    metadata.sourceStatus = sourceStatus;
    metadata.elementStatus = age > SPACE_ORBIT_FRESH_AGE_MS ? 'stale' : 'fresh';
    if (metadata.elementStatus === 'stale') metadata.sourceStatus = 'stale';
    const limit = Math.min(end, sourceExpiresAt, entry.epoch + SPACE_ORBIT_MAX_AGE_MS);
    if (limit < end) metadata.message = 'Predictions stop when the source snapshot or orbital elements expire.';
    // Prediction jobs never mutate the map's propagation record across async yields.
    const satrec = { ...entry.satrec };
    const cache = new Map<number, PassSample | null>();
    let validSamples = 0;
    let failedSamples = 0;
    const sample = (at: number): PassSample | null => {
      const cached = cache.get(at);
      if (cached !== undefined) return cached;
      checkAbort(options.signal);
      if (++samples > MAX_SAMPLES) throw new RangeError('Pass prediction sample budget exceeded.');
      if (at < start || at > limit) return null;
      const date = new Date(at);
      const propagated = lib.propagate(satrec, date);
      if (!propagated || !propagated.position || satrec.error !== 0) { failedSamples++; cache.set(at, null); return null; }
      const sidereal = lib.gstime(date);
      const geodetic = lib.eciToGeodetic(propagated.position, sidereal);
      if (!Number.isFinite(geodetic.height) || geodetic.height < 80) { failedSamples++; cache.set(at, null); return null; }
      const look = lib.ecfToLookAngles(observerGd, lib.eciToEcf(propagated.position, sidereal));
      const elevation = look.elevation / DEG;
      const azimuth = angle(look.azimuth / DEG);
      if (![elevation, azimuth].every(Number.isFinite)) { failedSamples++; cache.set(at, null); return null; }
      validSamples++;
      const sunElevation = elevation >= 0 ? observerSunElevation(observer, date) : NaN;
      const sunlit = elevation >= 0 && isSatelliteSunlit(propagated.position, date);
      const value = { at, elevation, azimuth, sunElevation, sunlit, visible: elevation >= SPACE_VISIBLE_MIN_ELEVATION_DEG && sunElevation <= SPACE_OBSERVER_DARKNESS_DEG && sunlit };
      cache.set(at, value);
      return value;
    };
    const crossing = (left: number, right: number, predicate: (value: PassSample) => boolean): number => {
      const initial = sample(left);
      if (!initial) return right;
      const initialState = predicate(initial);
      for (let iteration = 0; iteration < 20 && right - left > 250; iteration++) {
        const midpoint = Math.floor((left + right) / 2);
        const value = sample(midpoint);
        if (!value) break;
        if (predicate(value) === initialState) left = midpoint; else right = midpoint;
      }
      return Math.floor((left + right) / 2);
    };
    const makePass = async (aosAt: number, losAt: number, coarse: PassSample[], ongoing: boolean, clipped: boolean): Promise<void> => {
      if (!coarse.length || losAt <= aosAt) return;
      const best = coarse.reduce((a, b) => a.elevation >= b.elevation ? a : b);
      let left = Math.max(aosAt, best.at - STEP_MS);
      let right = Math.min(losAt, best.at + STEP_MS);
      for (let iteration = 0; iteration < 24 && right - left > 250; iteration++) {
        const first = left + (right - left) / 3;
        const second = right - (right - left) / 3;
        const a = sample(Math.floor(first)); const b = sample(Math.floor(second));
        if (!a || !b) break;
        if (a.elevation < b.elevation) left = first; else right = second;
      }
      const refined = sample(Math.floor((left + right) / 2));
      const peak = refined && refined.elevation > best.elevation ? refined : best;
      if (peak.elevation < minPeak) return;
      const aos = sample(aosAt); const los = sample(losAt);
      if (!aos || !los) return;
      const windows: SpaceVisibilityWindow[] = [];
      let visibleStart: number | null = null;
      let visibleMax = 0;
      let previous: PassSample | null = null;
      const times = new Set<number>([aosAt, losAt, peak.at]);
      for (let at = aosAt; at < losAt; at += VISIBLE_STEP_MS) times.add(at);
      for (const at of [...times].sort((a, b) => a - b)) {
        const value = sample(at);
        if (!value) { if (visibleStart !== null && previous) windows.push({ startAt: visibleStart, endAt: previous.at, maxElevationDeg: visibleMax }); visibleStart = null; previous = null; continue; }
        if (value.visible) {
          if (visibleStart === null) { visibleStart = previous ? crossing(previous.at, at, point => point.visible) : at; visibleMax = value.elevation; }
          visibleMax = Math.max(visibleMax, value.elevation);
        } else if (visibleStart !== null) {
          windows.push({ startAt: visibleStart, endAt: previous ? crossing(previous.at, at, point => point.visible) : at, maxElevationDeg: visibleMax });
          visibleStart = null;
        }
        previous = value;
        await checkpoint();
      }
      if (visibleStart !== null) windows.push({ startAt: visibleStart, endAt: losAt, maxElevationDeg: visibleMax });
      const elementStatus = peak.at - entry.epoch > SPACE_ORBIT_FRESH_AGE_MS ? 'stale' : 'fresh';
      metadata.passes.push({
        noradId: id, name: entry.item.name, aosAt, peakAt: peak.at, losAt, maxElevationDeg: peak.elevation,
        aosAzimuthDeg: aos.azimuth, peakAzimuthDeg: peak.azimuth, losAzimuthDeg: los.azimuth,
        aosDirection: direction(aos.azimuth), peakDirection: direction(peak.azimuth), losDirection: direction(los.azimuth),
        ongoing, endsAfterWindow: clipped, visible: windows.some(window => window.endAt > window.startAt), visibleWindows: windows,
        visibleAtPeak: peak.visible, observerSunElevationAtPeakDeg: peak.sunElevation, satelliteSunlitAtPeak: peak.sunlit,
        sourceStatus: elementStatus === 'stale' ? 'stale' : sourceStatus, sourceExpiresAt,
        elementEpoch: entry.epoch, elementStatus,
      });
    };
    let previous: PassSample | null = null;
    let aosAt: number | null = null;
    let coarse: PassSample[] = [];
    let ongoing = false;
    for (let at = start; ; at = Math.min(at + STEP_MS, limit)) {
      const value = sample(at);
      if (!value) {
        if (aosAt !== null && previous) await makePass(aosAt, previous.at, coarse, ongoing, true);
        aosAt = null; coarse = []; previous = null;
      } else {
        if (value.elevation > 0) {
          if (aosAt === null) { ongoing = previous === null && at === start; aosAt = previous ? crossing(previous.at, at, point => point.elevation > 0) : at; coarse = []; }
          coarse.push(value);
        } else if (aosAt !== null) {
          const losAt = previous ? crossing(previous.at, at, point => point.elevation > 0) : at;
          await makePass(aosAt, losAt, coarse, ongoing, false);
          aosAt = null; coarse = [];
        }
        previous = value;
      }
      await checkpoint();
      if (at >= limit) break;
    }
    if (aosAt !== null && previous) await makePass(aosAt, limit, coarse, ongoing, true);
    metadata.status = metadata.passes.length ? 'predicted' : validSamples ? 'no-passes' : 'unavailable';
    if (failedSamples) {
      metadata.message = 'Propagation failed for part of this window; the pass list may be incomplete.';
      metadata.sourceStatus = 'unavailable';
    }
  }
  checkAbort(options.signal);
  return {
    generatedAt: start, windowStart: start, windowEnd: end, observer, satellites,
    passes: satellites.flatMap(satellite => satellite.passes).sort((a, b) => a.aosAt - b.aosAt),
    requestedCount: ids.length, processedCount: selected.length, truncated: ids.length > selected.length,
  };
}
