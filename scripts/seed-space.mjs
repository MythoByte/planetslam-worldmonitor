#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnvFile, getRedisCredentials, redisCommand, acquireLock, releaseLock, writeExtraKeyWithMetaAtomically } from './_seed-utils.mjs';
import { SPACE_DATASETS, spaceKey, validSpaceData } from '../api/_space-data.js';
import { fetchSpaceDataset } from './_space-providers.mjs';

export async function seedSpace({ now = Date.now(), names = Object.keys(SPACE_DATASETS), fetchDataset = fetchSpaceDataset,
  command, lock = acquireLock, unlock = releaseLock, publish = writeExtraKeyWithMetaAtomically } = {}) {
  const runId = randomUUID();
  const results = [];
  // One durable admission token per attempted refresh survives failures/restarts.
  // In particular LL2 gets at most four provider calls per rolling hour per shared Redis.
  if (!command) {
    const { url, token } = getRedisCredentials();
    command = commands => redisCommand(url, token, commands);
  }
  for (const dataset of names) {
    const config = SPACE_DATASETS[dataset];
    if (!config) throw new Error('Unknown space dataset');
    const domain = `space:${dataset}`;
    let held = false;
    try {
      held = await lock(domain, runId, 180_000);
      if (!held) { results.push({ dataset, status: 'locked' }); continue; }
      const admission = await command(['SET', `space:attempt:${dataset}:v1`, String(now), 'NX', 'PX', config.intervalMs]);
      if (admission?.result !== 'OK') { results.push({ dataset, status: 'cooldown' }); continue; }
      const response = await fetchDataset(dataset, { now });
      if (!validSpaceData(dataset, response?.data)) throw new Error('Invalid normalized data');
      const fetchedAt = Date.now();
      const snapshot = { dataset, fetchedAt, observedAt: response.observedAt, data: response.data };
      const recordCount = response.data.items?.length ?? response.data.points?.length ?? response.data.kp?.length ?? 0;
      await publish({ key: spaceKey(dataset), data: snapshot, ttlSeconds: Math.ceil(config.maxAgeMs / 1000),
        metaTtlSeconds: Math.ceil(config.maxAgeMs / 1000) + 86400, recordCount, fetchedAt,
        extra: { dataset, observedAt: response.observedAt, provider: config.provider, sourceVersion: 'space-v1', schemaVersion: 1 } });
      results.push({ dataset, status: 'published', recordCount });
    } catch {
      // Do not log raw network errors: NASA URLs include a server-side key.
      // Never overwrite last-good data or move its clock after a failed fetch.
      results.push({ dataset, status: 'failed' });
    } finally {
      if (held) await unlock(domain, runId).catch(() => {});
    }
  }
  return results;
}

async function main() {
  loadEnvFile(import.meta.url);
  let stopping = false;
  let wake;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; wake?.(); });
  const loop = process.argv.includes('--loop');
  do {
    const results = await seedSpace();
    console.log(JSON.stringify({ service: 'planetslam-space', at: new Date().toISOString(), results }));
    if (!loop) { if (results.some(result => result.status === 'failed')) process.exitCode = 1; break; }
    if (!stopping) await new Promise(resolve => { const timer = setTimeout(resolve, 60_000); wake = () => { clearTimeout(timer); resolve(); }; });
  } while (!stopping);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Space seeder could not start. Check Redis configuration.'); process.exitCode = 1; });
}
