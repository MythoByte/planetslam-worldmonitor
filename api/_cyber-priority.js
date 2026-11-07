// Worker/reader contract. Unknown scores are null, never zero.
export const EPSS_SOURCE = 'https://www.first.org/epss/';
export const CVE_RECORD_BASE = 'https://cveawg.mitre.org/api/cve/';
export const CVSS_SOURCE = 'https://www.cve.org/';
const id = s => typeof s === 'string' && /^CVE-\d{4}-\d{4,}$/.test(s);
const stamp = n => Number.isFinite(n) && n > 0;
const unique = items => new Set(items.map(i => i?.id)).size === items.length;
export function validPriorityData(name, d) {
  if (!d || !Array.isArray(d.items) || !unique(d.items) || !stamp(d.catalogFetchedAt)) return false;
  if (name === 'epss') return d.items.length <= 10000 && Number.isInteger(d.requestedCount) && d.requestedCount > 0 && d.requestedCount <= 10000
    && d.items.length <= d.requestedCount && /^\d{4}-\d{2}-\d{2}$/.test(d.scoreDate) && stamp(Date.parse(d.scoreDate))
    && typeof d.model === 'string' && d.model.length > 0 && d.model.length <= 80
    && d.items.every(i => i && id(i.id) && Number.isFinite(i.probability) && i.probability >= 0 && i.probability <= 1 && Number.isFinite(i.percentile) && i.percentile >= 0 && i.percentile <= 1);
  return name === 'cvss' && d.items.length > 0 && d.items.length <= 40 && d.items.every(i => i && id(i.id)
    && (i.score === null && i.version === null && i.provider === null && i.vector === null || Number.isFinite(i.score) && i.score >= 0 && i.score <= 10
      && ['4.0', '3.1', '3.0'].includes(i.version) && typeof i.provider === 'string' && i.provider.length <= 120
      && typeof i.vector === 'string' && i.vector.startsWith('CVSS:' + i.version + '/') && i.vector.length <= 300)
    && (i.updatedAt === null || stamp(i.updatedAt)));
}
