// Wire contract shared by the central worker and cache-only edge reader.
export const INCIDENT_PROVIDER = 'UMD GoTech Cyber Events Database';
export const INCIDENT_SOURCE_URL = 'https://cybereventsdatabase.org/';
export const INCIDENT_INTERVAL_MS = 6 * 3600_000;
export const INCIDENT_MAX_AGE_MS = 48 * 3600_000;
export const INFRA_MAX_AGE_MS = 3 * 3600_000;
export const CYBER_NEWS_SOURCES = ['bleeping', 'krebs', 'hackernews'];
const text = (v, max) => typeof v === 'string' && v.length <= max;
const stamp = v => Number.isFinite(v) && v > 0;
const url = v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
const coords = i => i.latitude === null && i.longitude === null || Number.isFinite(i.latitude) && Math.abs(i.latitude) <= 90 && Number.isFinite(i.longitude) && Math.abs(i.longitude) <= 180;
export function validIncidentData(data) {
  return data && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 20
    && data.coverage === 'Public recent-record sample; monthly research updates'
    && data.items.every(i => i && text(i.id, 80) && i.id.length > 0 && text(i.organization, 200) && text(i.country, 100)
      && /^(?:[A-Z]{2}|unknown)$/.test(i.countryCode) && text(i.sector, 160) && text(i.category, 160) && text(i.description, 1200)
      && stamp(i.eventAt) && stamp(i.reportedAt) && (i.updatedAt === null || stamp(i.updatedAt))
      && ['reported', 'claim-reported'].includes(i.verification) && coords(i)
      && url(i.url) && (i.reportUrl === '' || url(i.reportUrl)) && text(i.changeLog, 1000));
}
export function validInfrastructureData(data) {
  return data && Array.isArray(data.items) && data.items.length <= 1000 && Number.isInteger(data.totalCount) && data.totalCount >= data.items.length
    && typeof data.truncated === 'boolean' && stamp(data.sourceFetchedAt)
    && data.items.every(i => i && text(i.id, 200) && i.id.length > 0 && text(i.indicator, 500) && i.indicator.length > 0 && text(i.source, 80)
      && text(i.country, 100) && /^(?:[A-Z]{2}|unknown)$/.test(i.countryCode) && text(i.category, 160)
      && stamp(i.observedAt) && coords(i) && url(i.url));
}
