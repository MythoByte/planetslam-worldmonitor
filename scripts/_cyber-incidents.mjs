import ISO2_TO_ISO3 from '../shared/iso2-to-iso3.js';
import { countryCentroid } from './lib/country-centroid.mjs';
import { unwrapEnvelope } from './_seed-envelope-source.mjs';
import { parseStoredSeedJson } from './_seed-payload-codec.mjs';
import { validIncidentData, validInfrastructureData, INFRA_MAX_AGE_MS, INCIDENT_SOURCE_URL } from '../api/_cyber-incidents.js';
import { httpsUrl } from '../api/_cyber-data.js';
const ISO3_TO_ISO2 = Object.fromEntries(Object.entries(ISO2_TO_ISO3).map(([a, b]) => [b, a]));
const clean = (value, max) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
function date(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const n = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(n) && n > 0 && n <= now + 60_000 ? n : null;
}
export function normalizeCyberIncidents(raw, now = Date.now()) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) throw new Error('Invalid public recent-record sample');
  const ids = new Set();
  const items = raw.filter(row => row?.is_sample !== true).map(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || ids.has(row.id)) throw new Error('Invalid incident identity');
    ids.add(row.id);
    const countryCode = ISO3_TO_ISO2[row.country_iso3] || 'unknown';
    const point = countryCode === 'unknown' ? null : countryCentroid(countryCode);
    const description = clean(row.description, 1200);
    return { id: row.id, organization: clean(row.organization, 200) || 'Organization not reported',
      country: clean(row.country, 100) || 'Unknown', countryCode,
      sector: clean(row.industry, 160) || 'Unknown', category: clean(row.event_subtype || row.event_type, 160) || 'Unspecified',
      description, eventAt: date(row.event_date, now), reportedAt: date(row.reported_date, now), updatedAt: date(row.updated_date, now),
      verification: /claims? (?:to have|responsibility)|alleged|unverified/i.test(description) ? 'claim-reported' : 'reported',
      latitude: point?.lat ?? null, longitude: point?.lng ?? null,
      url: `${INCIDENT_SOURCE_URL}eventdetails?id=${encodeURIComponent(row.id)}`,
      reportUrl: httpsUrl(row.source_url), changeLog: clean(row.change_log, 1000) };
  }).sort((a, b) => b.reportedAt - a.reportedAt || a.id.localeCompare(b.id));
  const data = { items, coverage: 'Public recent-record sample; monthly research updates' };
  if (!validIncidentData(data)) throw new Error('Invalid normalized incidents');
  return { data, observedAt: Math.max(...items.map(i => i.reportedAt)) };
}
const SOURCE_URLS = {
  CYBER_THREAT_SOURCE_FEODO: 'https://feodotracker.abuse.ch/', CYBER_THREAT_SOURCE_URLHAUS: 'https://urlhaus.abuse.ch/',
  CYBER_THREAT_SOURCE_C2INTEL: 'https://github.com/drb-ra/C2IntelFeeds', CYBER_THREAT_SOURCE_OTX: 'https://otx.alienvault.com/',
  CYBER_THREAT_SOURCE_ABUSEIPDB: 'https://www.abuseipdb.com/',
};
export function projectCyberInfrastructure(raw, meta, now = Date.now()) {
  const { data: value, _seed: seed } = unwrapEnvelope(raw);
  const fetchedAt = seed?.fetchedAt ?? meta?.fetchedAt;
  if (!Array.isArray(value?.threats) || !Number.isFinite(fetchedAt) || fetchedAt <= 0 || fetchedAt > now + 60_000 || now - fetchedAt > INFRA_MAX_AGE_MS) throw new Error('Shared IOC snapshot unavailable');
  const seen = new Set();
  const items = value.threats.slice(0, 1000).map(t => {
    if (!t || typeof t.id !== 'string' || !t.id.length || !SOURCE_URLS[t.source] || seen.has(t.id)) throw new Error('Invalid IOC identity'); seen.add(t.id);
    const observedAt = t.lastSeenAt > 0 ? t.lastSeenAt : t.firstSeenAt;
    if (!Number.isFinite(observedAt) || observedAt <= 0 || observedAt > now + 60_000 || typeof t.indicator !== 'string' || !t.indicator.length) throw new Error('Invalid IOC observation');
    const lat = t.location?.latitude, lon = t.location?.longitude;
    const located = Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
    const code = typeof t.country === 'string' ? t.country.toUpperCase() : '';
    return { id: t.id, indicator: clean(t.indicator, 500), source: t.source.replace('CYBER_THREAT_SOURCE_', ''),
      country: clean(t.country, 100) || 'Unknown', countryCode: Object.hasOwn(ISO2_TO_ISO3, code) ? code : 'unknown',
      category: clean(t.type?.replace('CYBER_THREAT_TYPE_', '').replaceAll('_', ' '), 160) || 'Unspecified',
      observedAt, latitude: located ? lat : null, longitude: located ? lon : null, url: SOURCE_URLS[t.source] };
  }).sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id));
  const data = { items, totalCount: value.threats.length, truncated: value.threats.length > items.length, sourceFetchedAt: fetchedAt };
  if (!validInfrastructureData(data)) throw new Error('Invalid infrastructure snapshot');
  return { data, fetchedAt, observedAt: items.length ? Math.max(...items.map(i => i.observedAt)) : fetchedAt };
}
export async function readSharedCyberInfrastructure(command, now) {
  const [snapshot, meta] = await Promise.all([command(['GET', 'cyber:threats:v2']), command(['GET', 'seed-meta:cyber:threats'])]);
  return projectCyberInfrastructure(parseStoredSeedJson(snapshot?.result || 'null'), parseStoredSeedJson(meta?.result || 'null'), now);
}
