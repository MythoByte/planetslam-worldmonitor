import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { parseStoredSeedJson } from './_seed-payload-codec.mjs';
import { cyberEnvelope, cyberKey } from '../api/_cyber-data.js';
import { validPriorityData, CVE_RECORD_BASE } from '../api/_cyber-priority.js';
const CVE = /^CVE-\d{4}-\d{4,}$/;
export async function cachedKev(command, now) {
  const raw = await command(['GET', cyberKey('kev')]);
  const e = cyberEnvelope('kev', parseStoredSeedJson(raw?.result || 'null'), now);
  if (!e.data || e.status === 'unavailable') throw Error('KEV prerequisite unavailable');
  return e;
}
export function epssParser(kev, now = Date.now()) {
  const wanted = new Set(kev.data.items.map(i => i.id)), seen = new Set();
  const data = { items: [], requestedCount: wanted.size, catalogFetchedAt: kev.fetchedAt, scoreDate: '', model: '' };
  let header = false, rows = 0;
  return {
    line(line) {
      if (line.startsWith('#')) {
        if (header || data.scoreDate) throw Error('Unexpected EPSS metadata');
        data.model = line.match(/model_version:([^,\s]+)/)?.[1] || '';
        data.scoreDate = line.match(/score_date:(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        const at = Date.parse(data.scoreDate + 'T00:00:00Z');
        if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== data.scoreDate || at > now || now - at > 4 * 86400000) throw Error('EPSS publication unavailable');
        return;
      }
      if (!header) { if (line !== 'cve,epss,percentile') throw Error('Invalid EPSS header'); header = true; return; }
      if (!line.trim()) return;
      const fields = line.split(','), [id, p, percentile] = fields;
      if (++rows > 2000000 || fields.length !== 3 || !CVE.test(id) || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(p) || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(percentile)
        || !Number.isFinite(Number(p)) || !Number.isFinite(Number(percentile)) || Number(p) > 1 || Number(percentile) > 1) throw Error('Invalid EPSS row');
      if (wanted.has(id)) {
        if (seen.has(id)) throw Error('Duplicate EPSS record'); seen.add(id);
        data.items.push({ id, probability: Number(p), percentile: Number(percentile) });
      }
    },
    finish() {
      if (!header || !rows || !data.items.length || !validPriorityData('epss', data)) throw Error('Empty EPSS coverage');
      return { data, observedAt: Date.parse(data.scoreDate + 'T00:00:00Z') };
    },
  };
}
export async function fetchEpss({ fetchFn = fetch, command, now = Date.now() }) {
  const kev = await cachedKev(command, now), parser = epssParser(kev, now);
  const response = await fetchFn('https://epss.empiricalsecurity.com/epss_scores-current.csv.gz', { signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw Error('EPSS unavailable');
  let compressed = 0, expanded = 0, rest = '';
  const bound = new Transform({ transform(chunk, _, callback) { compressed += chunk.length; callback(compressed > 15000000 ? Error('EPSS compressed limit') : null, chunk); } });
  const decoder = new TextDecoder();
  await pipeline(Readable.fromWeb(response.body), bound, createGunzip(), async stream => {
    for await (const chunk of stream) {
      expanded += chunk.length;
      if (expanded > 100000000) throw Error('EPSS expanded limit');
      rest += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = rest.indexOf('\n')) >= 0) { parser.line(rest.slice(0, end).replace(/\r$/, '')); rest = rest.slice(end + 1); }
      if (rest.length > 1000) throw Error('EPSS line limit');
    }
    rest += decoder.decode(); if (rest) parser.line(rest.replace(/\r$/, ''));
  });
  return parser.finish();
}
export function normalizeCvss(raw, expected, now = Date.now()) {
  if (raw?.cveMetadata?.cveId !== expected || raw.cveMetadata.state !== 'PUBLISHED') throw Error('Invalid CVE record');
  const updatedAt = Date.parse(raw.cveMetadata.dateUpdated);
  if (!Number.isFinite(updatedAt) || updatedAt > now + 60000) throw Error('Invalid CVE revision');
  const containers = [raw.containers?.cna, ...(raw.containers?.adp || [])];
  for (const container of containers) {
    for (const version of ['4.0', '3.1', '3.0']) {
      const metrics = (container?.metrics || []).filter(m => !m.scenarios?.length || m.scenarios.every(s => s.value === 'GENERAL'))
        .map(m => m['cvssV' + version.replace('.', '_')]).filter(Boolean).sort((a, b) => b.baseScore - a.baseScore);
      const m = metrics[0];
      if (!m) continue;
      const item = { id: expected, score: m.baseScore, version, provider: String(container.providerMetadata?.shortName || 'CVE contributor').slice(0, 120), vector: m.vectorString, updatedAt };
      if (!validPriorityData('cvss', { items: [item], catalogFetchedAt: now })) throw Error('Invalid CVSS metric');
      return item;
    }
  }
  return { id: expected, score: null, version: null, provider: null, vector: null, updatedAt };
}
export async function fetchCvss({ fetchFn = fetch, command, now = Date.now(), readJson }) {
  const kev = await cachedKev(command, now);
  const budget = AbortSignal.timeout(60000);
  const boundedFetch = (url, options = {}) => fetchFn(url, { ...options, signal: options.signal ? AbortSignal.any([budget, options.signal]) : budget });
  // Forty newest KEV additions, two requests at a time. No user/watchlist data leaves the browser.
  const ids = [...kev.data.items].sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id)).slice(0, 40).map(i => i.id);
  const items = [];
  for (let at = 0; at < ids.length; at += 2) items.push(...await Promise.all(ids.slice(at, at + 2).map(async id =>
    normalizeCvss(await readJson(CVE_RECORD_BASE + id, boundedFetch), id, now))));
  return { data: { items, catalogFetchedAt: kev.fetchedAt }, observedAt: Math.max(...items.map(i => i.updatedAt)) };
}
