import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installCyberFixtures as fixtures } from './cyber-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'Cyber is a PlanetSlam edition');
async function boot(page: Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'cyber-acceptance', clearStorage: true, localStorage: { 'worldmonitor-theme': 'dark' } } });
  await page.goto('/dashboard?variant=tech');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  await expect(page).toHaveTitle(/PlanetSlam Tech/);
  await expect(page).toHaveURL(/variant=tech/);
  await expect(page.locator('[data-variant="cyber"]')).toHaveCount(0);
  await expect(page.locator('[data-panel="cyber-news"]')).toHaveCount(0);
}
const panel = (page: Page, name: string) => page.locator(`#panelsGrid [data-panel="cyber-${name}"]`);
async function mounted(page: Page, name: string, text: string) {
  await expect(async () => { await panel(page, name).scrollIntoViewIfNeeded(); await expect(panel(page, name)).toContainText(text); }).toPass({ timeout: 20000 });
}
for (const width of [1440, 390]) {
  test(`Cyber panels, filters, watchlist persistence and edition navigation at ${width}px`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 }); await fixtures(page); await boot(page);
    const security = page.locator('#panelsGrid [data-panel="security"]');
    await expect(async () => { await security.scrollIntoViewIfNeeded(); await expect(security).toContainText('Synthetic Docker patch announcement'); }).toPass({ timeout: 30000 });
    await expect(security.locator('img')).toHaveCount(0);
    await security.screenshot({ path: info.outputPath(`tech-security-${width}.png`) });
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
      await page.locator('[data-variant="tech"]').first().click();
      await expect(page).toHaveURL(/variant=tech/); await mounted(page, 'watchlist', 'docker ×');
    }
    await panel(page, 'watchlist').getByRole('button', { name: 'Remove docker', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('planetslam-cyber-watchlist-v1'))).toBe('[]');
    expect(errors).toEqual([]);
  });
}
test('Cyber displays delayed sources and outage, then retry recovers', async ({ page }, info) => {
  await fixtures(page, { news: { status: 'stale', message: 'Synthetic partial publisher outage.' }, kev: { status: 'unavailable', data: null, message: 'Synthetic catalog outage.' } });
  await boot(page);
  await mounted(page, 'kev', 'Synthetic catalog outage.');
  await page.screenshot({ path: info.outputPath('cyber-outage.png') });
  await fixtures(page); await panel(page, 'kev').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page, 'kev')).toContainText('Apply the vendor update.');
  await expect(panel(page, 'kev')).not.toContainText('Synthetic catalog outage.');
});
