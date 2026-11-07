#!/usr/bin/env node
import { generateCyberBrief } from './_cyber-brief.mjs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnvFile, getRedisCredentials, redisCommand, acquireLock, releaseLock, writeExtraKeyWithMetaAtomically } from './_seed-utils.mjs';
import { CYBER_DATASETS, cyberKey, validCyberData } from '../api/_cyber-data.js';
import { fetchCyberDataset } from './_cyber-providers.mjs';

export async function seedCyber({ now = Date.now(), names = ['kev', ...Object.keys(CYBER_DATASETS).filter(n => n !== 'kev' && n !== 'brief'), 'brief'], fetchDataset = fetchCyberDataset, generateBrief = generateCyberBrief,
  command, lock = acquireLock, unlock = releaseLock, publish = writeExtraKeyWithMetaAtomically } = {}) {
  const runId = randomUUID();
  const results = [];
  // One durable admission token per attempted refresh survives failures/restarts.
  // Provider work is centralized and never triggered by a dashboard reader.
  if (!command) {
    const { url, token } = getRedisCredentials();
    command = commands => redisCommand(url, token, commands);
  }
  for (const dataset of names) {
    const config = CYBER_DATASETS[dataset];
    if (!Object.hasOwn(CYBER_DATASETS, dataset)) throw new Error('Unknown cyber dataset');
    const domain = `cyber-dashboard:${dataset}`;
    let held = false;
    try {
      held = await lock(domain, runId, 180_000);
      if (!held) { results.push({ dataset, status: 'locked' }); continue; }
      const admission = await command(['SET', `cyber-dashboard:attempt:${dataset}:v1`, String(now), 'NX', 'PX', config.intervalMs]);
      if (admission?.result !== 'OK') { results.push({ dataset, status: 'cooldown' }); continue; }
      const response = dataset === 'brief' ? await generateBrief({ now: Date.now(), command }) : await fetchDataset(dataset, { now, command });
      if (response?.skipped) { results.push({ dataset, status: response.skipped }); continue; }
      if (!validCyberData(dataset, response?.data) || !Number.isFinite(response.observedAt) || response.observedAt <= 0 || response.observedAt > Date.now() + 60_000) throw new Error('Invalid normalized data');
      const fetchedAt = dataset === 'infrastructure' ? response.fetchedAt : Date.now();
      const snapshot = { dataset, fetchedAt, observedAt: response.observedAt, data: response.data };
      const recordCount = response.data.items.length;
      await publish({ key: cyberKey(dataset), data: snapshot, ttlSeconds: Math.ceil(config.maxAgeMs / 1000),
        metaTtlSeconds: Math.ceil(config.maxAgeMs / 1000) + 86400, recordCount, fetchedAt,
        extra: { dataset, observedAt: response.observedAt, provider: config.provider, sourceVersion: 'cyber-dashboard-v1', schemaVersion: 1 } });
      results.push({ dataset, status: 'published', recordCount });
    } catch {
      // Keep raw upstream failures out of operational logs.
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
    const results = await seedCyber();
    console.log(JSON.stringify({ service: 'planetslam-cyber', at: new Date().toISOString(), results }));
    if (!loop) { if (results.some(result => result.status === 'failed')) process.exitCode = 1; break; }
    if (!stopping) await new Promise(resolve => { const timer = setTimeout(resolve, 60_000); wake = () => { clearTimeout(timer); resolve(); }; });
  } while (!stopping);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Cyber seeder could not start. Check Redis configuration.'); process.exitCode = 1; });
}
