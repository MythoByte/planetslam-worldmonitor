// Pure contract shared by cache-only edge readers and the orbital seeder.
export const ORBIT_INTERVAL_MS = 6 * 60 * 60_000;
export const ORBIT_FETCH_MAX_AGE_MS = 48 * 60 * 60_000;
export const ORBIT_ELEMENT_STALE_MS = 48 * 60 * 60_000;
export const ORBIT_ELEMENT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const ORBIT_GROUPS = Object.freeze({
  stations: { label: 'Space stations', providerGroup: 'stations', limit: 100 },
  weather: { label: 'Weather', providerGroup: 'weather', limit: 600 },
  science: { label: 'Space & Earth science', providerGroup: 'science', limit: 600 },
  communications: { label: 'Communications / GEO', providerGroup: 'geo', limit: 1200 },
  starlink: { label: 'Starlink', providerGroup: 'starlink', limit: 2000 },
});
export const orbitGroupUrl = id => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${ORBIT_GROUPS[id].providerGroup}&FORMAT=JSON`;
export const orbitGroupKey = id => `space:orbits:group:${id}:v1`;
const numeric = value => !['string', 'number'].includes(typeof value) || value === '' ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const cleanText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';

/** Accept only Earth/TEME/UTC/SGP4 elements; GP JSON may omit these documented defaults. */
export function normalizeOrbitObject(raw, groups, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  for (const [key, expected] of Object.entries({ CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4' })) {
    if (raw[key] != null && raw[key] !== expected) return null;
  }
  if (typeof raw.EPOCH !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(raw.EPOCH)) return null;
  const epoch = Date.parse(raw.EPOCH.endsWith('Z') ? raw.EPOCH : `${raw.EPOCH}Z`);
  // An epoch can legitimately be slightly in the future; cap it at one day.
  if (!Number.isFinite(epoch) || epoch > now + 86_400_000 || now - epoch > ORBIT_ELEMENT_MAX_AGE_MS) return null;
  const omm = {};
  for (const key of ['NORAD_CAT_ID', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT', 'ELEMENT_SET_NO']) {
    const value = numeric(raw[key]);
    if (value === null) return null;
    omm[key] = value;
  }
  if (!Number.isInteger(omm.NORAD_CAT_ID) || omm.NORAD_CAT_ID < 1 || omm.NORAD_CAT_ID > 999999999
    || omm.MEAN_MOTION <= 0 || omm.MEAN_MOTION > 20 || omm.ECCENTRICITY < 0 || omm.ECCENTRICITY >= 1
    || omm.INCLINATION < 0 || omm.INCLINATION > 180 || !Number.isInteger(omm.ELEMENT_SET_NO) || omm.ELEMENT_SET_NO < 0
    || ['RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY'].some(key => omm[key] < 0 || omm[key] > 360)) return null;
  for (const key of ['RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY']) omm[key] %= 360;
  if (raw.EPHEMERIS_TYPE != null) {
    if (numeric(raw.EPHEMERIS_TYPE) !== 0) return null;
    omm.EPHEMERIS_TYPE = 0;
  }
  if (raw.CLASSIFICATION_TYPE != null) {
    if (!['U', 'C'].includes(raw.CLASSIFICATION_TYPE)) return null;
    omm.CLASSIFICATION_TYPE = raw.CLASSIFICATION_TYPE;
  }
  if (raw.REV_AT_EPOCH != null) {
    const rev = numeric(raw.REV_AT_EPOCH);
    if (!Number.isInteger(rev) || rev < 0) return null;
    omm.REV_AT_EPOCH = rev;
  }
  const noradId = String(omm.NORAD_CAT_ID);
  const name = cleanText(raw.OBJECT_NAME, 160) || `NORAD ${noradId}`;
  const objectId = cleanText(raw.OBJECT_ID, 40);
  Object.assign(omm, { OBJECT_NAME: name, OBJECT_ID: objectId, EPOCH: new Date(epoch).toISOString() });
  return { noradId, name, objectId, epoch, omm, groups: groups.filter(id => Object.hasOwn(ORBIT_GROUPS, id)),
    elementStatus: now - epoch > ORBIT_ELEMENT_STALE_MS ? 'stale' : 'fresh' };
}

/** Reassess source clocks and element epochs on every read; ingestion does not renew failed groups. */
export function projectOrbitCatalog(data, now = Date.now()) {
  const validContainer = Array.isArray(data?.groups) && data.groups.length <= Object.keys(ORBIT_GROUPS).length && Array.isArray(data?.items);
  const supplied = validContainer ? data.groups : [];
  const rawItems = validContainer ? data.items : [];
  const sourceGroups = new Map(supplied.filter(group => group && Object.hasOwn(ORBIT_GROUPS, group.id)).map(group => [group.id, group]));
  const eligibleGroups = new Set();
  const groups = Object.entries(ORBIT_GROUPS).map(([id, config]) => {
    const source = sourceGroups.get(id);
    const validSource = source && Number.isInteger(source.totalCount) && source.totalCount >= 0 && typeof source.truncated === 'boolean';
    const fetchedAt = validSource && Number.isFinite(source.fetchedAt) && source.fetchedAt > 0 && source.fetchedAt <= now + 60_000 ? source.fetchedAt : null;
    const age = fetchedAt ? now - fetchedAt : Infinity;
    const status = age > ORBIT_FETCH_MAX_AGE_MS ? 'unavailable' : source?.refreshFailed || age > 2 * ORBIT_INTERVAL_MS ? 'stale' : 'fresh';
    if (status !== 'unavailable') eligibleGroups.add(id);
    const totalCount = Number.isInteger(source?.totalCount) && source.totalCount >= 0 ? source.totalCount : 0;
    return { id, label: config.label, providerGroup: config.providerGroup, sourceUrl: orbitGroupUrl(id), status, fetchedAt,
      objectCount: 0, totalCount, truncated: source?.truncated === true, ...(source?.refreshFailed ? { refreshFailed: true } : {}),
      ...(status === 'unavailable' ? { message: 'Group unavailable; no usable source snapshot.' }
        : status === 'stale' ? { message: 'Last known group; source refresh delayed.' } : {}) };
  });
  const objects = new Map();
  for (const raw of rawItems.slice(0, 10_000)) {
    if (!raw || !Array.isArray(raw.groups)) continue;
    const membership = raw.groups.filter(id => eligibleGroups.has(id));
    if (!membership.length) continue;
    const item = normalizeOrbitObject(raw.omm, membership, now);
    if (!item) continue;
    const previous = objects.get(item.noradId);
    if (previous) {
      const merged = [...new Set([...previous.groups, ...item.groups])];
      const selected = item.epoch > previous.epoch ? item : previous;
      objects.set(item.noradId, { ...selected, groups: merged });
    } else objects.set(item.noradId, item);
  }
  const items = [...objects.values()];
  for (const group of groups) {
    const members = items.filter(item => item.groups.includes(group.id));
    group.objectCount = members.length;
    // A nonempty source turning entirely invalid/expired is not an empty sky.
    if (group.status !== 'unavailable' && group.totalCount > 0 && !members.length) {
      group.status = 'unavailable';
      group.message = 'No usable orbital elements remain in this group.';
    } else if (group.status === 'fresh' && members.some(item => item.elementStatus === 'stale')) {
      group.status = 'stale';
      group.message = 'Some orbital elements are older than 48 hours.';
    }
  }
  const available = groups.filter(group => group.status !== 'unavailable');
  const status = !available.length ? 'unavailable' : groups.some(group => group.status !== 'fresh') ? 'stale' : 'fresh';
  const complete = groups.every(group => group.status === 'fresh' && !group.truncated && group.objectCount === group.totalCount);
  return { status, data: { items, groups, complete },
    fetchedAt: Math.max(0, ...available.map(group => group.fetchedAt || 0)) || null,
    observedAt: Math.max(0, ...items.map(item => item.epoch)) || null,
    ...(status === 'unavailable' ? { message: 'Orbital catalog unavailable; missing data does not mean an empty sky.' }
      : !complete ? { message: 'Partial or bounded orbital catalog. Inspect group counts and source times.' } : {}) };
}
