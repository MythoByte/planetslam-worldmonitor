import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import type { CyberDataset, CyberEnvelope } from '../src/types/cyber-dashboard';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'Cyber is a PlanetSlam edition');
function fixture(dataset: CyberDataset): CyberEnvelope<unknown> {
  const now = Date.now();
  const news = { items: [
    { id: 'n1', title: 'Synthetic Docker patch announcement', summary: '<img src=x onerror=alert(1)> Fixture text.', publisher: 'Synthetic publisher', url: 'https://example.com/docker', publishedAt: now - 60_000, topic: 'Vulnerabilities' },
    { id: 'n2', title: 'Synthetic ransomware incident report', summary: 'An unrelated synthetic story.', publisher: 'Synthetic publisher', url: 'https://example.com/incident', publishedAt: now - 120_000, topic: 'Ransomware' },
  ] };
  const kev = { version: 'synthetic-1', totalCount: 1, catalogAt: now, items: [{ id: 'CVE-2026-99999', vendor: 'Synthetic Vendor', product: 'Docker', title: 'Synthetic Docker vulnerability', description: 'Fixture, not an actual vulnerability.', action: 'Apply the vendor update.', addedAt: now - 86400_000, dueDate: '2026-11-20', ransomware: 'Unknown', url: 'https://example.com/cve', references: ['https://example.com/vendor'] }] };
  const base = { dataset, status: 'fresh' as const, provider: 'Synthetic acceptance provider', sourceUrl: 'https://example.com/source', fetchedAt: now, observedAt: now, expiresAt: now + 3600000 };
  if (dataset === 'health') return { ...base, data: { items: ['kev', 'bleeping', 'krebs', 'hackernews'].map(name => ({ ...base, dataset: name, provider: `Synthetic ${name}`, data: null })) } };
  return { ...base, data: dataset === 'news' ? news : kev };
}
async function fixtures(page: Page, overrides: Partial<Record<CyberDataset, Partial<CyberEnvelope<unknown>>>> = {}) {
  await page.route('**/api/cyber-dashboard?*', route => {
    const dataset = new URL(route.request().url()).searchParams.get('dataset') as CyberDataset;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...fixture(dataset), ...overrides[dataset] }) });
  });
}
async function boot(page: Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'cyber-acceptance', clearStorage: true, localStorage: { 'worldmonitor-theme': 'dark' } } });
  await page.goto('/dashboard?variant=cyber');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  await expect(page).toHaveTitle(/PlanetSlam Cyber/);
}
const panel = (page: Page, name: string) => page.locator(`#panelsGrid [data-panel="cyber-${name}"]`);
async function mounted(page: Page, name: string, text: string) {
  await expect(async () => { await panel(page, name).scrollIntoViewIfNeeded(); await expect(panel(page, name)).toContainText(text); }).toPass({ timeout: 20000 });
}
for (const width of [1440, 390]) {
  test(`Cyber panels, filters, watchlist persistence and edition navigation at ${width}px`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 }); await fixtures(page); await boot(page);
    await mounted(page, 'news', 'Synthetic Docker patch announcement');
    await expect(panel(page, 'news').locator('img')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`cyber-overview-${width}.png`) });
    await panel(page, 'news').getByRole('combobox', { name: 'Topic', exact: true }).selectOption('Ransomware');
    await expect(panel(page, 'news')).toContainText('Synthetic ransomware incident report');
    await expect(panel(page, 'news')).not.toContainText('Synthetic Docker patch announcement');
    await panel(page, 'news').getByRole('combobox', { name: 'Topic', exact: true }).selectOption('all');
    await mounted(page, 'kev', 'Apply the vendor update.');
    await expect(panel(page, 'kev')).toContainText('Unknown (not confirmed)');
    await panel(page, 'kev').getByLabel('Search catalog').fill('no-such-product');
    await panel(page, 'kev').getByLabel('Search catalog').press('Tab');
    await expect(panel(page, 'kev')).toContainText('No catalog entries match');
    await panel(page, 'kev').getByLabel('Search catalog').fill('docker');
    await panel(page, 'kev').getByLabel('Search catalog').press('Tab');
    await expect(panel(page, 'kev')).toContainText('CVE-2026-99999');
    await mounted(page, 'watchlist', 'Add a technology');
    await panel(page, 'watchlist').getByRole('button', { name: '+ Docker', exact: true }).click();
    await expect(panel(page, 'watchlist')).toContainText('Synthetic Docker patch announcement');
    await expect(panel(page, 'watchlist')).toContainText('CVE-2026-99999');
    expect(await page.evaluate(() => localStorage.getItem('planetslam-cyber-watchlist-v1'))).toBe('["docker"]');
    await page.screenshot({ path: info.outputPath(`cyber-watchlist-${width}.png`) });
    await mounted(page, 'health', 'Synthetic hackernews');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`cyber-${width}.png`), fullPage: true });
    await info.attach(`Cyber ${width}px with synthetic responses`, { path: info.outputPath(`cyber-${width}.png`), contentType: 'image/png' });
    await page.reload(); await mounted(page, 'watchlist', 'docker ×');
    await expect(panel(page, 'watchlist')).toContainText('CVE-2026-99999');
    if (width >= 1000) {
      await page.locator('[data-variant="space"]').first().click();
      await expect(page).toHaveURL(/variant=space/);
      await expect(page).toHaveTitle(/PlanetSlam Space/);
      await page.locator('[data-variant="cyber"]').first().click();
      await expect(page).toHaveURL(/variant=cyber/); await mounted(page, 'watchlist', 'docker ×');
    }
    await panel(page, 'watchlist').getByRole('button', { name: 'Remove docker', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('planetslam-cyber-watchlist-v1'))).toBe('[]');
    expect(errors).toEqual([]);
  });
}
test('Cyber displays delayed sources and outage, then retry recovers', async ({ page }, info) => {
  await fixtures(page, { news: { status: 'stale', message: 'Synthetic partial publisher outage.' }, kev: { status: 'unavailable', data: null, message: 'Synthetic catalog outage.' } });
  await boot(page); await mounted(page, 'news', 'Synthetic partial publisher outage.');
  await expect(panel(page, 'news')).toContainText('Delayed · last known data');
  await mounted(page, 'kev', 'Synthetic catalog outage.');
  await page.screenshot({ path: info.outputPath('cyber-outage.png') });
  await fixtures(page); await panel(page, 'kev').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page, 'kev')).toContainText('Apply the vendor update.');
  await expect(panel(page, 'kev')).not.toContainText('Synthetic catalog outage.');
});
