import type { OrbitCatalogData, OrbitGroupHealth, SpaceOmmRecord } from '@/types/space';
import type { PreparedSpaceOrbit, SpaceGroundTrack, SpaceOrbitOptions, SpaceOrbitPosition, SpaceOrbitSnapshot } from '@/types/space-orbits';

export const SPACE_ORBIT_EVENT = 'planetslam:space-orbits';
export const MAX_SPACE_ORBIT_MARKERS = 120;
export const SPACE_ORBIT_FRESH_AGE_MS = 48 * 60 * 60_000;
export const SPACE_ORBIT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const SPACE_ORBIT_SOURCE_MAX_AGE_MS = 48 * 60 * 60_000;
const SOURCE_FRESH_AGE_MS = 12 * 60 * 60_000;
const MAX_FUTURE_EPOCH_MS = 24 * 60 * 60_000;
const GROUPS = new Set(['stations', 'weather', 'science', 'communications', 'starlink']);

type SatelliteLib = typeof import('satellite.js');
let satelliteLib: SatelliteLib | null = null;
let loadingLib: Promise<SatelliteLib> | null = null;
const trackCache = new Map<string, SpaceGroundTrack[]>();
let published: SpaceOrbitSnapshot | null = null;

async function library(): Promise<SatelliteLib> {
  if (satelliteLib) return satelliteLib;
  if (!loadingLib) loadingLib = import('satellite.js').then(module => {
    satelliteLib = module;
    return module;
  }).catch(error => { loadingLib = null; throw error; });
  return loadingLib;
}

/** CelesTrak GP JSON omits Z: its OMM EPOCH is UTC, never the viewer's local time. */
export function spaceOmmEpoch(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(value)) return null;
  const timestamp = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19) ? timestamp : null;
}

function usableEpoch(epoch: number, now: number): boolean {
  return Number.isFinite(epoch) && now - epoch <= SPACE_ORBIT_MAX_AGE_MS && epoch - now <= MAX_FUTURE_EPOCH_MS;
}

export function spaceOrbitGroupStatus(group: OrbitGroupHealth, now = Date.now()): 'fresh' | 'stale' | 'unavailable' {
  if (!group || group.status === 'unavailable' || typeof group.fetchedAt !== 'number'
    || !Number.isFinite(group.fetchedAt) || group.fetchedAt > now + 5 * 60_000
    || now - group.fetchedAt > SPACE_ORBIT_SOURCE_MAX_AGE_MS) return 'unavailable';
  return group.status === 'stale' || now - group.fetchedAt > SOURCE_FRESH_AGE_MS ? 'stale' : 'fresh';
}

function validOmm(omm: SpaceOmmRecord): boolean {
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (!omm || !Number.isSafeInteger(omm.NORAD_CAT_ID) || omm.NORAD_CAT_ID <= 0) return false;
  if (!finite(omm.MEAN_MOTION) || omm.MEAN_MOTION <= 0 || omm.MEAN_MOTION > 20
    || !finite(omm.ECCENTRICITY) || omm.ECCENTRICITY < 0 || omm.ECCENTRICITY >= 1
    || !finite(omm.INCLINATION) || omm.INCLINATION < 0 || omm.INCLINATION > 180) return false;
  return [omm.RA_OF_ASC_NODE, omm.ARG_OF_PERICENTER, omm.MEAN_ANOMALY].every(value => finite(value) && value >= 0 && value <= 360)
    && [omm.BSTAR, omm.MEAN_MOTION_DOT, omm.MEAN_MOTION_DDOT].every(finite);
}

/** Prepare trusted-shape GP records once per catalog refresh; SGP4 stays lazy. */
export async function prepareSpaceOrbits(catalog: OrbitCatalogData, now = Date.now()): Promise<PreparedSpaceOrbit[]> {
  const lib = await library();
  if (!Array.isArray(catalog?.items) || !Number.isFinite(now)) return [];
  const sources = Array.isArray(catalog.groups) ? catalog.groups.filter(group => spaceOrbitGroupStatus(group, now) !== 'unavailable') : [];
  const prepared: PreparedSpaceOrbit[] = [];
  const seen = new Set<string>();
  for (const item of catalog.items) {
    if (!item || typeof item.noradId !== 'string' || seen.has(item.noradId) || !validOmm(item.omm)) continue;
    const epoch = spaceOmmEpoch(item.omm.EPOCH);
    if (epoch === null || !usableEpoch(epoch, now) || !Number.isFinite(item.epoch)
      || Math.abs(item.epoch - epoch) > 1000 || String(item.omm.NORAD_CAT_ID) !== item.noradId
      || !Array.isArray(item.groups) || !item.groups.some(group => GROUPS.has(group))) continue;
    try {
      const sourceGroups = sources.filter(source => item.groups.includes(source.id)).map(source => ({ id: source.id, expiresAt: source.fetchedAt! + SPACE_ORBIT_SOURCE_MAX_AGE_MS, fetchedAt: source.fetchedAt!, refreshFailed: source.refreshFailed === true }));
      if (!sourceGroups.length) continue;
      const satrec = lib.json2satrec({ ...item.omm });
      if (satrec.error !== 0 || !Number.isFinite(satrec.no) || satrec.no <= 0) continue;
      prepared.push({ item, epoch, satrec, sourceGroups });
      seen.add(item.noradId);
    } catch { /* Invalid or unsupported element sets are unavailable, never (0,0) positions. */ }
  }
  return prepared;
}

function position(entry: PreparedSpaceOrbit, now: Date, selected: boolean): SpaceOrbitPosition | null {
  if (!satelliteLib || !usableEpoch(entry.epoch, now.getTime())) return null;
  try {
    const propagated = satelliteLib.propagate(entry.satrec, now);
    if (!propagated || !propagated.position || !propagated.velocity || entry.satrec.error !== 0) return null;
    const geodetic = satelliteLib.eciToGeodetic(propagated.position, satelliteLib.gstime(now));
    const longitude = satelliteLib.degreesLong(geodetic.longitude);
    const latitude = satelliteLib.degreesLat(geodetic.latitude);
    const altitudeKm = geodetic.height;
    const { x, y, z } = propagated.velocity;
    const velocityKmS = Math.hypot(x, y, z);
    if (![longitude, latitude, altitudeKm, velocityKmS].every(Number.isFinite)
      || latitude < -90 || latitude > 90 || altitudeKm < 80 || velocityKmS <= 0) return null;
    return {
      noradId: entry.item.noradId, name: entry.item.name, longitude, latitude, altitudeKm, velocityKmS,
      inclinationDeg: entry.item.omm.INCLINATION, periodMinutes: 1440 / entry.item.omm.MEAN_MOTION,
      epoch: entry.epoch, elementStatus: now.getTime() - entry.epoch > SPACE_ORBIT_FRESH_AGE_MS ? 'stale' : 'fresh', selected,
    };
  } catch { return null; }
}

/** Split and interpolate at ±180 so a ground track never crosses the map through Greenwich. */
export function splitSpaceGroundTrack(points: [number, number, number][]): [number, number, number][][] {
  const segments: [number, number, number][][] = [];
  let current: [number, number, number][] = [];
  for (const point of points) {
    if (!point.every(Number.isFinite)) { if (current.length > 1) segments.push(current); current = []; continue; }
    const previous = current[current.length - 1];
    if (previous && Math.abs(point[0] - previous[0]) > 180) {
      const adjustedLongitude = point[0] + (point[0] < previous[0] ? 360 : -360);
      const boundary = previous[0] >= 0 ? 180 : -180;
      if (adjustedLongitude === previous[0]) {
        // +180 and -180 denote the same meridian; avoid a 0/0 interpolation.
        current.push([boundary, point[1], point[2]]);
        if (current.length > 1) segments.push(current);
        current = [[-boundary, point[1], point[2]]];
        continue;
      }
      const fraction = (boundary - previous[0]) / (adjustedLongitude - previous[0]);
      const latitude = previous[1] + (point[1] - previous[1]) * fraction;
      const altitude = previous[2] + (point[2] - previous[2]) * fraction;
      current.push([boundary, latitude, altitude]);
      if (current.length > 1) segments.push(current);
      current = [[-boundary, latitude, altitude]];
    }
    current.push([...point]);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function groundTrack(entry: PreparedSpaceOrbit, now: Date): SpaceGroundTrack[] {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const key = `${entry.item.noradId}:${entry.epoch}:${minute}`;
  const cached = trackCache.get(key);
  if (cached) return cached;
  const tracks: SpaceGroundTrack[] = [];
  for (const phase of ['past', 'future'] as const) {
    const points: [number, number, number][] = [];
    for (let step = phase === 'past' ? -45 : 0; step <= (phase === 'past' ? 0 : 45); step++) {
      const sample = position(entry, new Date(minute + step * 60_000), true);
      // Split gaps rather than bridging an invalid/decayed propagation sample.
      points.push(sample ? [sample.longitude, sample.latitude, sample.altitudeKm] : [NaN, NaN, NaN]);
    }
    tracks.push(...splitSpaceGroundTrack(points).map(points => ({ phase, points })));
  }
  trackCache.set(key, tracks);
  while (trackCache.size > 32) trackCache.delete(trackCache.keys().next().value!);
  return tracks;
}

export function emptySpaceOrbitSnapshot(now = Date.now()): SpaceOrbitSnapshot {
  return { calculatedAt: now, selectedId: '', selected: null, positions: [], groundTracks: [], shownCount: 0, totalCount: 0, expiredCount: 0 };
}

/** Positions are bounded; only the selected object gets a cached ±45 minute track. */
export function calculateSpaceOrbitSnapshot(prepared: PreparedSpaceOrbit[], options: SpaceOrbitOptions): SpaceOrbitSnapshot {
  const now = options.now ?? new Date();
  if (!satelliteLib || !Number.isFinite(now.getTime())) return emptySpaceOrbitSnapshot();
  const allCandidates = prepared.filter(entry => entry.item.noradId === options.selectedId || (options.includeGroup !== false && entry.item.groups.includes(options.group)));
  const current = allCandidates.filter(entry => usableEpoch(entry.epoch, now.getTime())
    && entry.sourceGroups.some(source => source.expiresAt >= now.getTime()
      && (entry.item.noradId === options.selectedId || source.id === options.group)));
  const selectedEntry = current.find(entry => entry.item.noradId === options.selectedId);
  const ordered = selectedEntry ? [selectedEntry, ...current.filter(entry => entry !== selectedEntry)] : current;
  const positions = ordered.slice(0, MAX_SPACE_ORBIT_MARKERS)
    .map(entry => position(entry, now, entry === selectedEntry)).filter((value): value is SpaceOrbitPosition => value !== null);
  const selected = positions.find(value => value.selected) ?? null;
  return {
    calculatedAt: now.getTime(), selectedId: options.selectedId, selected, positions,
    groundTracks: selected && selectedEntry ? groundTrack(selectedEntry, now) : [],
    shownCount: positions.length, totalCount: allCandidates.length, expiredCount: allCandidates.length - current.length,
  };
}

export function publishSpaceOrbitSnapshot(snapshot: SpaceOrbitSnapshot): void {
  published = snapshot;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SpaceOrbitSnapshot>(SPACE_ORBIT_EVENT, { detail: snapshot }));
}

export function getPublishedSpaceOrbitSnapshot(): SpaceOrbitSnapshot {
  return published ?? emptySpaceOrbitSnapshot();
}
