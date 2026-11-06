import { ORBIT_GROUPS, ORBIT_INTERVAL_MS, ORBIT_FETCH_MAX_AGE_MS, orbitGroupUrl, orbitGroupKey, normalizeOrbitObject, projectOrbitCatalog } from '../api/_space-orbits.js';

const MAX_RESPONSE_BYTES = 12_000_000;
const USER_AGENT = 'PlanetSlam-Space/1.0 (+https://planetslam.com)';

/** Normalize only a bounded current selection; malformed/nonempty is never a quiet sky. */
export function normalizeOrbitGroup(raw, id, now = Date.now()) {
  const config = ORBIT_GROUPS[id];
  if (!config || !Array.isArray(raw) || raw.length > 50_000) throw new Error('Invalid orbital group');
  const objects = new Map();
  for (const record of raw) {
    const item = normalizeOrbitObject(record, [id], now);
    if (!item) continue;
    const previous = objects.get(item.noradId);
    if (!previous || item.epoch > previous.epoch) objects.set(item.noradId, item);
  }
  if (raw.length && !objects.size) throw new Error('No usable orbital elements');
  const valid = [...objects.values()].sort((a, b) => (a.noradId === '25544' ? -1 : b.noradId === '25544' ? 1 : b.epoch - a.epoch || Number(a.noradId) - Number(b.noradId)));
  return { id, fetchedAt: now, totalCount: raw.length, truncated: valid.length > config.limit,
    items: valid.slice(0, config.limit) };
}

/** Fixed provider URL and byte ceiling; no redirects, retries, credentials, or arbitrary queries. */
export async function fetchOrbitGroup(id, { now = Date.now(), fetchFn = fetch } = {}) {
  if (!Object.hasOwn(ORBIT_GROUPS, id)) throw new Error('Unknown orbital group');
  const response = await fetchFn(orbitGroupUrl(id), {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(25_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Orbital provider HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error('Orbital response exceeds limit'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing orbital response');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Orbital response exceeds limit'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return normalizeOrbitGroup(JSON.parse(new TextDecoder().decode(buffer)), id, now);
}

function readGroupResponse(result, id) {
  let value = result?.result;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value?.id === id && Array.isArray(value.items) && Number.isFinite(value.fetchedAt) ? value : null;
}

/** Per-group durable admission and last-good cache survive partial provider outages/restarts. */
export async function seedOrbitCatalog({ command, publish, now = Date.now(), fetchGroup = fetchOrbitGroup } = {}) {
  if (typeof command !== 'function' || typeof publish !== 'function') throw new Error('Orbital publisher requires Redis helpers');
  const snapshots = [];
  for (const id of Object.keys(ORBIT_GROUPS)) {
    // A failed Redis read is not a confirmed cache miss and must prevent provider work.
    const previous = readGroupResponse(await command(['GET', orbitGroupKey(id)]), id);
    const failureKey = `space:orbits:failure:${id}:v1`;
    const failure = await command(['GET', failureKey]);
    const failedAt = Number(failure?.result);
    const lastGood = previous && Number.isFinite(failedAt) && failedAt > previous.fetchedAt
      ? { ...previous, refreshFailed: true } : previous;
    const admission = await command(['SET', `space:orbits:attempt:${id}:v1`, String(now), 'NX', 'PX', ORBIT_INTERVAL_MS]);
    if (admission?.result !== 'OK') {
      if (lastGood) snapshots.push(lastGood);
      continue;
    }
    try {
      const group = await fetchGroup(id, { now });
      await publish({ key: orbitGroupKey(id), data: group, fetchedAt: group.fetchedAt, recordCount: group.items.length,
        ttlSeconds: ORBIT_FETCH_MAX_AGE_MS / 1000, metaTtlSeconds: ORBIT_FETCH_MAX_AGE_MS / 1000 + 86400,
        extra: { sourceVersion: 'celestrak-gp-json-v1', schemaVersion: 1, group: id, totalCount: group.totalCount, truncated: group.truncated } });
      // A residual old marker is harmless: readers compare it to the source clock.
      await command(['DEL', failureKey]).catch(() => {});
      snapshots.push(group);
    } catch {
      // Failed fetch/publication never rewrites the last-good group or metadata clock.
      await command(['SET', failureKey, String(now), 'EX', ORBIT_FETCH_MAX_AGE_MS / 1000]);
      if (previous) snapshots.push({ ...previous, refreshFailed: true });
    }
  }
  const metadata = snapshots.map(({ items, ...meta }) => meta);
  const data = { items: snapshots.flatMap(group => group.items), groups: metadata };
  const projected = projectOrbitCatalog(data, now);
  if (!projected.fetchedAt) throw new Error('No usable orbital group snapshots');
  // Keep per-group failure bits in the canonical cache so reads cannot launder them.
  return { data: projected.data, observedAt: projected.observedAt, fetchedAt: projected.fetchedAt };
}
