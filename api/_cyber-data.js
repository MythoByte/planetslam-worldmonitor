import { validIncidentData, validInfrastructureData, INCIDENT_PROVIDER, INCIDENT_SOURCE_URL, INCIDENT_INTERVAL_MS, INCIDENT_MAX_AGE_MS, INFRA_MAX_AGE_MS, CYBER_NEWS_SOURCES } from './_cyber-incidents.js';
// Shared normalized contract for the cache-only API and central worker.
const MINUTE = 60_000;
export const CYBER_DATASETS = Object.freeze({
  incidents: { provider: INCIDENT_PROVIDER, sourceUrl: INCIDENT_SOURCE_URL, intervalMs: INCIDENT_INTERVAL_MS, maxAgeMs: INCIDENT_MAX_AGE_MS },
  infrastructure: { provider: 'Shared cyber IOC collection', sourceUrl: 'https://planetslam.com/dashboard?variant=cyber', intervalMs: 5 * MINUTE, staleAfterMs: 150 * MINUTE, maxAgeMs: INFRA_MAX_AGE_MS },
  kev: { provider: 'CISA Known Exploited Vulnerabilities', sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', feedUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', intervalMs: 60 * MINUTE, maxAgeMs: 48 * 60 * MINUTE },
  bleeping: { provider: 'BleepingComputer', sourceUrl: 'https://www.bleepingcomputer.com/', feedUrl: 'https://www.bleepingcomputer.com/feed/', intervalMs: 15 * MINUTE, maxAgeMs: 6 * 60 * MINUTE },
  krebs: { provider: 'Krebs on Security', sourceUrl: 'https://krebsonsecurity.com/', feedUrl: 'https://krebsonsecurity.com/feed/', intervalMs: 15 * MINUTE, maxAgeMs: 6 * 60 * MINUTE },
  hackernews: { provider: 'The Hacker News', sourceUrl: 'https://thehackernews.com/', feedUrl: 'https://feeds.feedburner.com/TheHackersNews', intervalMs: 15 * MINUTE, maxAgeMs: 6 * 60 * MINUTE },
});
export const cyberKey = name => `cyber-dashboard:${name}:v1`;
export function httpsUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
const str = (v, max = 2000) => typeof v === 'string' && v.length <= max;
const time = v => Number.isFinite(v) && v > 0;
export function validCyberData(name, data) {
  if (name === 'incidents') return validIncidentData(data);
  if (name === 'infrastructure') return validInfrastructureData(data);
  if (!Object.hasOwn(CYBER_DATASETS, name) || !data || !Array.isArray(data.items) || !data.items.length || data.items.length > 10000) return false;
  if (name === 'kev') return time(data.catalogAt) && Number.isInteger(data.totalCount) && data.totalCount === data.items.length && str(data.version, 40)
    && data.items.every(i => i && typeof i === 'object' && /^CVE-\d{4}-\d{4,}$/.test(i.id) && str(i.vendor, 160) && str(i.product, 200) && str(i.title, 400)
      && str(i.description, 1200) && str(i.action, 1200) && time(i.addedAt) && /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate)
      && ['Known', 'Unknown'].includes(i.ransomware) && httpsUrl(i.url) && Array.isArray(i.references) && i.references.length <= 8 && i.references.every(httpsUrl));
  return data.items.length <= 100 && data.items.every(i => i && typeof i === 'object' && str(i.id, 500) && str(i.title, 500) && str(i.summary, 500)
    && str(i.publisher, 80) && time(i.publishedAt) && httpsUrl(i.url) && str(i.topic, 40));
}
export function cyberEnvelope(name, snapshot, now = Date.now()) {
  const config = CYBER_DATASETS[name];
  if (!config) throw new Error('Unknown cyber dataset');
  const valid = snapshot?.dataset === name && validCyberData(name, snapshot.data)
    && time(snapshot.fetchedAt) && snapshot.fetchedAt <= now + MINUTE
    && (name !== 'infrastructure' || snapshot.data.sourceFetchedAt === snapshot.fetchedAt)
    && (!snapshot.observedAt || time(snapshot.observedAt) && snapshot.observedAt <= now + MINUTE);
  const age = valid ? Math.max(0, now - snapshot.fetchedAt) : Infinity;
  const status = age > config.maxAgeMs ? 'unavailable' : age > (config.staleAfterMs ?? config.intervalMs * 2) ? 'stale' : 'fresh';
  return { dataset: name, status, provider: config.provider, sourceUrl: config.sourceUrl,
    fetchedAt: valid ? snapshot.fetchedAt : null, observedAt: valid ? snapshot.observedAt ?? null : null,
    expiresAt: valid ? snapshot.fetchedAt + config.maxAgeMs : null,
    message: status === 'unavailable' ? 'No usable cached update. This does not mean there are no threats.' : status === 'stale' ? 'Provider refresh delayed; showing the last successful update.' : '',
    data: status === 'unavailable' ? null : snapshot.data };
}
export function aggregateCyberNews(envelopes, now = Date.now()) {
  const sources = envelopes.filter(e => CYBER_NEWS_SOURCES.includes(e.dataset));
  const usable = sources.filter(e => e.status !== 'unavailable' && e.data);
  const seen = new Set();
  const items = usable.flatMap(e => e.data.items).filter(i => i.publishedAt <= now + MINUTE && now - i.publishedAt <= 7 * 86400_000)
    .sort((a, b) => b.publishedAt - a.publishedAt).filter(i => {
      const u = new URL(i.url); u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$/.test(k)) u.searchParams.delete(k);
      const key = u.href; if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 150);
  return { dataset: 'news', status: !usable.length ? 'unavailable' : sources.every(e => e.status === 'fresh') ? 'fresh' : 'stale',
    provider: 'Curated cyber publishers', sourceUrl: 'https://planetslam.com/dashboard?variant=cyber',
    fetchedAt: usable.length ? Math.min(...usable.map(e => e.fetchedAt)) : null,
    observedAt: items[0]?.publishedAt ?? null, expiresAt: usable.length ? Math.min(...usable.map(e => e.expiresAt)) : null,
    message: usable.length < sources.length ? 'Some publishers are unavailable. See Cyber Data Status for coverage.' : '',
    data: usable.length ? { items } : null };
}
