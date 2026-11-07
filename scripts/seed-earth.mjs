#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnvFile, getRedisCredentials, redisCommand, acquireLock, releaseLock, writeExtraKeyWithMetaAtomically } from './_seed-utils.mjs';
import { EARTH_SOURCES, earthKey, validEarthData } from '../api/_earth-data.js';
import { EARTH_HISTORY_KEY, EARTH_HISTORY_INTERVAL_MS, EARTH_HISTORY_RETENTION_MS, EARTH_HISTORY_SOURCE_IDS, appendEarthHistory, validEarthHistory } from '../api/_earth-history.js';
import { unwrapEnvelope } from '../api/_seed-envelope.js';
import { fetchEarthSource } from './_earth-providers.mjs';

/** Provider-level snapshots preserve independent last-good clocks during partial outages. */
export async function seedEarth({ now = Date.now(), names = Object.keys(EARTH_SOURCES).filter(id => !EARTH_SOURCES[id].cacheKey),
  fetchSource = fetchEarthSource, command, lock = acquireLock, unlock = releaseLock,
  publish = writeExtraKeyWithMetaAtomically } = {}) {
  const runId = randomUUID(), results = [];
  if (!command) { const { url, token } = getRedisCredentials(); command = commands => redisCommand(url, token, commands); }
  for (const sourceId of names) {
    const config = EARTH_SOURCES[sourceId];
    if (!config || config.cacheKey) throw new Error('Unknown or externally ingested Earth source');
    const domain = `earth:${sourceId}`;
    let held = false;
    try {
      held = await lock(domain, runId, 90_000);
      if (!held) { results.push({ sourceId, status: 'locked' }); continue; }
      const admission = await command(['SET', `earth:attempt:${sourceId}:v1`, String(now), 'NX', 'PX', config.intervalMs]);
      if (admission?.result !== 'OK') { results.push({ sourceId, status: 'cooldown' }); continue; }
      const response = await fetchSource(sourceId, { now });
      if (!validEarthData(sourceId, response?.data)) throw new Error('Invalid Earth data');
      const fetchedAt = Date.now();
      const snapshot = { sourceId, dataset: config.dataset, fetchedAt, observedAt: response.observedAt, data: response.data };
      await publish({ key: earthKey(sourceId), data: snapshot, ttlSeconds: Math.ceil(config.maxAgeMs / 1000),
        metaTtlSeconds: Math.ceil(config.maxAgeMs / 1000) + 86400, fetchedAt, recordCount: response.data.items.length,
        extra: { dataset: config.dataset, provider: config.provider, sourceId, observedAt: response.observedAt, sourceVersion: 'earth-v1', schemaVersion: 1 } });
      results.push({ sourceId, status: 'published', recordCount: response.data.items.length });
    } catch {
      // No raw network errors or payloads. Never refresh old data's timestamps on failure.
      results.push({ sourceId, status: 'failed' });
    } finally { if (held) await unlock(domain, runId).catch(() => {}); }
  }
  return results;
}
/** A separate lock protects the read/modify/write archive from concurrent workers. */
export async function seedEarthHistory({ now = Date.now(), command, lock = acquireLock, unlock = releaseLock,
  publish = writeExtraKeyWithMetaAtomically } = {}) {
  const runId = randomUUID(), domain = 'earth:history';
  if (!command) { const { url, token } = getRedisCredentials(); command = commands => redisCommand(url, token, commands); }
  let held = false;
  try {
    held = await lock(domain, runId, 120_000);
    if (!held) return { sourceId: 'history', status: 'locked' };
    const parse = value => value === null ? null : unwrapEnvelope(typeof value === 'string' ? JSON.parse(value) : value).data;
    const stored = await command(['GET', EARTH_HISTORY_KEY]);
    if (!stored || !Object.hasOwn(stored, 'result')) throw new Error('Archive read failed');
    const previous = parse(stored.result);
    if (previous !== null && !validEarthHistory(previous, now)) throw new Error('Invalid previous archive');
    if (previous && now - previous.fetchedAt < EARTH_HISTORY_INTERVAL_MS) return { sourceId: 'history', status: 'cooldown' };
    const rows = await command(['MGET', ...EARTH_HISTORY_SOURCE_IDS.map(earthKey)]);
    if (!Array.isArray(rows?.result) || rows.result.length !== EARTH_HISTORY_SOURCE_IDS.length) throw new Error('Source cache read failed');
    const snapshots = Object.fromEntries(EARTH_HISTORY_SOURCE_IDS.map((id, index) => [id, parse(rows.result[index])]));
    const archive = appendEarthHistory(previous, snapshots, now);
    if (!archive) return { sourceId: 'history', status: 'unavailable' };
    const ttlSeconds = Math.ceil(EARTH_HISTORY_RETENTION_MS / 1000);
    await publish({ key: EARTH_HISTORY_KEY, data: archive, ttlSeconds, metaTtlSeconds: ttlSeconds + 86400,
      fetchedAt: now, recordCount: archive.items.length, extra: { dataset: 'history', sourceVersion: 'earth-history-v1', schemaVersion: 1 } });
    return { sourceId: 'history', status: 'published', recordCount: archive.items.length };
  } catch {
    // A failed read or write must not replace the last-good archive or advance its clock.
    return { sourceId: 'history', status: 'failed' };
  } finally { if (held) await unlock(domain, runId).catch(() => {}); }
}
async function main() {
  loadEnvFile(import.meta.url);
  let stopping = false, wake;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; wake?.(); });
  do {
    const results = await seedEarth();
    results.push(await seedEarthHistory());
    console.log(JSON.stringify({ service: 'planetslam-earth', at: new Date().toISOString(), results }));
    if (!process.argv.includes('--loop')) { if (results.some(row => row.status === 'failed')) process.exitCode = 1; break; }
    if (!stopping) await new Promise(resolve => { const timer = setTimeout(resolve, 60_000); wake = () => { clearTimeout(timer); resolve(); }; });
  } while (!stopping);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Earth worker could not start. Check Redis configuration.'); process.exitCode = 1; });
}
