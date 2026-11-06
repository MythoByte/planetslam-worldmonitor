import type { Page } from '@playwright/test';
import type { CyberDataset, CyberEnvelope } from '../src/types/cyber-dashboard';

export function cyberFixture(dataset: CyberDataset): CyberEnvelope<unknown> {
  const now = Date.now();
  const news = { items: [
    { id: 'n1', title: 'Synthetic Docker patch announcement', summary: '<img src=x onerror=alert(1)> Fixture text.', publisher: 'Synthetic publisher', url: 'https://example.com/docker', publishedAt: now - 60_000, topic: 'Vulnerabilities' },
    { id: 'n2', title: 'Synthetic ransomware incident report', summary: 'An unrelated synthetic story.', publisher: 'Synthetic publisher', url: 'https://example.com/incident', publishedAt: now - 120_000, topic: 'Ransomware' },
  ] };
  const kev = { version: 'synthetic-1', totalCount: 1, catalogAt: now, items: [{ id: 'CVE-2026-99999', vendor: 'Synthetic Vendor', product: 'Docker', title: 'Synthetic Docker vulnerability', description: 'Fixture, not an actual vulnerability.', action: 'Apply the vendor update.', addedAt: now - 86400_000, dueDate: '2026-11-20', ransomware: 'Unknown', url: 'https://example.com/cve', references: ['https://example.com/vendor'] }] };
  const base = { dataset, status: 'fresh' as const, provider: 'Synthetic acceptance provider', sourceUrl: 'https://example.com/source', fetchedAt: now, observedAt: now, expiresAt: now + 3600000 };
  if (dataset === 'incidents') return { ...base, data: { coverage: 'Public recent-record sample; monthly research updates', items: [
    { id: 'synthetic-us', organization: 'Synthetic Hospital', country: 'United States', countryCode: 'US', sector: 'Healthcare', category: 'Encryption', description: 'Synthetic reported event, not an actual incident.', eventAt: now - 86400000, reportedAt: now - 60000, updatedAt: now - 30000, verification: 'reported', latitude: 40, longitude: -100, url: 'https://example.com/catalog/us', reportUrl: 'https://example.com/report/us', changeLog: '' },
    { id: 'synthetic-de', organization: 'Synthetic Rail', country: 'Germany', countryCode: 'DE', sector: 'Transport', category: 'Denial of service', description: 'Synthetic claim, not independently verified.', eventAt: now - 41 * 86400000, reportedAt: now - 40 * 86400000, updatedAt: null, verification: 'claim-reported', latitude: 51, longitude: 10, url: 'https://example.com/catalog/de', reportUrl: 'https://example.com/report/de', changeLog: '' },
    { id: 'synthetic-unlocated', organization: 'Synthetic Unlocated', country: 'Undetermined', countryCode: 'unknown', sector: 'Unknown', category: 'Unspecified', description: 'Unlocated fixture.', eventAt: now - 86400000, reportedAt: now - 180000, updatedAt: null, verification: 'reported', latitude: null, longitude: null, url: 'https://example.com/catalog/unknown', reportUrl: '', changeLog: '' },
  ] } };
  if (dataset === 'infrastructure') return { ...base, data: { sourceFetchedAt: now - 1800000, totalCount: 2, truncated: false, items: [
    { id: 'synthetic-c2', indicator: '198.51.100.42', source: 'FEODO', country: 'DE', countryCode: 'DE', category: 'C2 SERVER', observedAt: now - 60000, latitude: 51.5, longitude: 10.5, url: 'https://example.com/feed' },
    { id: 'synthetic-url', indicator: 'https://malware.example.test/payload', source: 'URLHAUS', country: 'US', countryCode: 'US', category: 'MALWARE HOST', observedAt: now - 60000, latitude: 35, longitude: -90, url: 'https://example.com/feed2' },
  ] } };
  if (dataset === 'health') return { ...base, data: { items: ['kev', 'bleeping', 'krebs', 'hackernews', 'incidents', 'infrastructure'].map(name => ({ ...base, dataset: name, provider: `Synthetic ${name}`, data: null })) } };
  return { ...base, data: dataset === 'news' ? news : kev };
}
export async function installCyberFixtures(page: Page, overrides: Partial<Record<CyberDataset, Partial<CyberEnvelope<unknown>>>> = {}) {
  await page.route('**/api/cyber-dashboard?*', route => {
    const dataset = new URL(route.request().url()).searchParams.get('dataset') as CyberDataset;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...cyberFixture(dataset), ...overrides[dataset] }) });
  });
}
