import { fetchGdeltBulkConflictEvents, gdeltTimestampToMs } from './_conflict-gdelt-bulk.mjs';

export const ATTACK_REPORT_KEY = 'gdelt:attack-reports:v1';
export const ATTACK_REPORT_META_KEY = 'seed-meta:gdelt:attack-reports';
export const ATTACK_REPORT_ACTIVATION_KEY = 'seed-activated:gdelt:attack-reports';
export const REPORT_WINDOW_MS = 24 * 60 * 60_000;
export const REPORT_FRESH_MS = 45 * 60_000;
export const MAX_ATTACK_REPORTS = 500;

function sourceUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return '';
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

// CAMEO 195 is aerial weapons use, not a missile/drone subtype or a verified
// impact. ActionGeo locates the coded action; publisher/actor locations do not.
export function parseAttackReports(csv) {
  const reports = [];
  for (const line of String(csv).split(/\r?\n/)) {
    const f = line.split('\t');
    if (f.length < 61 || f[25] !== '1' || f[26] !== '195' || f[29] !== '4') continue;
    const url = sourceUrl(f[60]);
    const latitude = f[56]?.trim() ? Number(f[56]) : NaN;
    const longitude = f[57]?.trim() ? Number(f[57]) : NaN;
    const indexedAt = gdeltTimestampToMs(f[59]);
    const eventMs = /^\d{8}$/.test(f[1]) ? Date.parse(`${f[1].slice(0,4)}-${f[1].slice(4,6)}-${f[1].slice(6,8)}T00:00:00Z`) : NaN;
    if (!/^\d{1,20}$/.test(f[0]) || !['1','2','3','4','5'].includes(f[51]) || !url || !f[52]?.trim() || !Number.isFinite(indexedAt)
      || !Number.isFinite(eventMs) || new Date(eventMs).toISOString().slice(0,10).replaceAll('-','') !== f[1]
      || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) continue;
    reports.push({
      id: `gdelt-air-${f[0]}`, latitude, longitude,
      locationName: f[52].replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, ' ').slice(0, 250),
      locationPrecision: f[51] === '1' ? 'country' : ['2','5'].includes(f[51]) ? 'region' : 'place',
      sourceUrl: url, publisher: new URL(url).hostname,
      eventDate: new Date(eventMs).toISOString().slice(0,10), indexedAt,
      articleCount: Math.min(1_000_000, Math.max(1, Number.parseInt(f[33],10) || 1)),
      kind: 'aerial', verification: 'reported',
    });
  }
  return reports;
}

export function attackReportsSnapshot(previous, now = Date.now()) {
  const reports = (Array.isArray(previous?.reports) ? previous.reports : []).filter(r =>
    Number.isFinite(r.indexedAt) && r.indexedAt >= now - REPORT_WINDOW_MS && r.indexedAt <= now + 15 * 60_000
    && r.eventDate >= new Date(now - REPORT_WINDOW_MS).toISOString().slice(0,10) && r.eventDate <= new Date(now).toISOString().slice(0,10));
  const sourceAge = now - Number(previous?.latestBatchAt);
  return {
    reports: reports.slice(0, MAX_ATTACK_REPORTS), updatedAt: Number(previous?.updatedAt) || 0,
    latestBatchAt: Number(previous?.latestBatchAt) || 0,
    status: !previous?.updatedAt ? 'unavailable' : sourceAge >= -15 * 60_000 && sourceAge <= REPORT_FRESH_MS ? 'fresh' : 'stale',
    coverageStart: Number(previous?.coverageStart) || 0,
    // Files can be missed during downtime; do not claim exhaustive coverage.
    completeWindow: false,
    limited: previous?.limited === true || reports.length > MAX_ATTACK_REPORTS,
  };
}

export async function refreshAttackReports(previous, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const bulk = await fetchGdeltBulkConflictEvents({ fetchImpl, mapExport: parseAttackReports });
  const latestBatchAt = gdeltTimestampToMs(bulk.exportTimestamp);
  if (!Number.isFinite(latestBatchAt) || now - latestBatchAt > REPORT_FRESH_MS || latestBatchAt > now + 15 * 60_000) throw new Error('GDELT event feed is stale');
  const unique = new Map();
  for (const report of [...(previous?.reports || []), ...bulk.events]) {
    if (!Number.isFinite(report?.latitude) || !Number.isFinite(report?.longitude)) continue;
    // One article/action area/day can produce multiple actor-pair event IDs.
    const key = `${report.sourceUrl}|${report.latitude.toFixed(2)},${report.longitude.toFixed(2)}|${report.eventDate}`;
    if (!unique.has(key) || unique.get(key).indexedAt < report.indexedAt) unique.set(key, report);
  }
  const coverageStart = Math.max(now - REPORT_WINDOW_MS, Math.min(previous?.coverageStart || Infinity, gdeltTimestampToMs(bulk.oldestExportTimestamp)));
  const raw = { reports: [...unique.values()].sort((a,b) => b.indexedAt - a.indexedAt || a.id.localeCompare(b.id)), updatedAt: now, latestBatchAt, coverageStart };
  return { ...attackReportsSnapshot(raw, now), exportsRequested: bulk.exportsRequested, exportsSucceeded: bulk.exportsSucceeded };
}

/** Health becomes strict only after both durable data and metadata exist. */
export async function publishAttackReports(snapshot, { writeSnapshot, writeMeta, activate }) {
  if (snapshot?.status !== 'fresh') return false;
  if (!await writeSnapshot(snapshot)) return false;
  if (!await writeMeta({ fetchedAt: snapshot.updatedAt, recordCount: snapshot.reports.length, sourceVersion: 'gdelt-events-2' })) return false;
  return await activate(snapshot.updatedAt);
}
