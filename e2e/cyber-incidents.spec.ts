import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installCyberFixtures } from './cyber-dashboard-fixtures';
test.skip(process.env.VITE_BRAND !== 'planetslam', 'Cyber is a PlanetSlam edition');
async function boot(page: Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'cyber-phase2-acceptance', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await page.goto('/dashboard?variant=cyber');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
}
for (const width of [1440, 390]) {
  test(`Cyber incident filters, map layers, source inspection and persistence at ${width}px`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 }); await installCyberFixtures(page); await boot(page);
    const tracker = page.locator('[data-panel="cyber-incidents"]');
    await expect(async () => { await tracker.scrollIntoViewIfNeeded(); await expect(tracker).toContainText('Synthetic Hospital'); }).toPass({ timeout: 20000 });
    await expect(tracker).toContainText('Monthly research updates'); await expect(tracker).toContainText('Claim in reporting');
    await tracker.getByRole('combobox', { name: 'Sector (incidents)', exact: true }).selectOption('Healthcare');
    await expect(tracker.locator('[data-cyber-incident]')).toHaveCount(1);
    await tracker.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await tracker.getByRole('combobox', { name: 'Reported / observed period', exact: true }).selectOption('30');
    await expect(tracker.locator('[data-cyber-incident="synthetic-de"]')).toHaveCount(0);
    await tracker.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await tracker.getByRole('combobox', { name: 'Country', exact: true }).selectOption('unknown');
    await expect(tracker.locator('[data-cyber-incident]')).toHaveCount(1); await expect(tracker).toContainText('omitted from the map');
    await tracker.getByRole('button', { name: 'Reset filters', exact: true }).click();
    if (width === 390) await tracker.locator('[data-cyber-incident="synthetic-us"]').getByRole('button', { name: 'Locate on map' }).click();
    else await tracker.getByRole('button', { name: 'Show Cyber map', exact: true }).click();
    await expect(page.locator('#mapContainer')).toHaveClass(/svg-mode/);
    const map = page.locator('#mapContainer');
    await expect(map.locator('.cyber-map-incident')).toHaveCount(2); await expect(map.locator('.cyber-map-infrastructure')).toHaveCount(2);
    await expect(map.locator('[data-cyber-marker="synthetic-unlocated"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`cyber-map-${width}.png`) });
    const controls = page.locator('[data-testid="cyber-map-controls"]');
    if (await controls.getAttribute('open') !== null) await controls.locator('summary').click();
    await map.locator('[data-cyber-marker="synthetic-us"]').click();
    await expect(controls.locator('[data-testid="cyber-map-detail"]')).toContainText('Synthetic Hospital');
    await expect(controls.getByRole('link', { name: 'Original reporting' })).toHaveAttribute('href', 'https://example.com/report/us');
    await controls.getByRole('combobox', { name: 'Country', exact: true }).selectOption('DE');
    await expect(map.locator('.cyber-map-incident')).toHaveCount(1); await expect(map.locator('.cyber-map-infrastructure')).toHaveCount(1);
    await expect(controls.locator('[data-testid="cyber-map-detail"]')).toHaveCount(0);
    await controls.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await controls.getByLabel('Reported incidents (amber)', { exact: true }).uncheck();
    await expect(map.locator('.cyber-map-incident')).toHaveCount(0); await expect(map.locator('.cyber-map-infrastructure')).toHaveCount(2);
    expect(await page.evaluate(() => localStorage.getItem('planetslam-cyber-explore-v1'))).toContain('"incidents":false');
    await page.screenshot({ path: info.outputPath(`cyber-infrastructure-${width}.png`) });
    await page.reload();
    await expect(page.locator('[data-testid="cyber-map-controls"]')).toContainText('0 reports / 2 infrastructure');
    await expect(map.locator('.cyber-map-incident')).toHaveCount(0);
    await controls.locator('summary').click();
    await controls.getByRole('combobox', { name: 'Inspect map marker' }).selectOption('infrastructure:synthetic-url');
    await controls.locator('summary').click();
    await map.locator('[data-cyber-marker="synthetic-url"]').click();
    await expect(controls.locator('[data-testid="cyber-map-detail"]')).toContainText('malware[.]example[.]test');
    await expect(controls.locator('a[href*="malware.example.test"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`cyber-phase2-${width}.png`), fullPage: true });
    await info.attach('Cyber Phase 2 with synthetic incident and indicator responses', { path: info.outputPath(`cyber-phase2-${width}.png`), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}
test('Cyber incident outage keeps the infrastructure layer and recovers without provider calls', async ({ page }) => {
  await installCyberFixtures(page, { incidents: { status: 'unavailable', data: null, message: 'Synthetic research-source outage.' } });
  await boot(page);
  const tracker = page.locator('[data-panel="cyber-incidents"]');
  await expect(async () => { await tracker.scrollIntoViewIfNeeded(); await expect(tracker).toContainText('Synthetic research-source outage.'); }).toPass({ timeout: 20000 });
  await tracker.getByRole('button', { name: 'Show Cyber map', exact: true }).click();
  await expect(page.locator('#mapContainer .cyber-map-incident')).toHaveCount(0);
  await expect(page.locator('#mapContainer .cyber-map-infrastructure')).toHaveCount(2);
  await installCyberFixtures(page);
  await tracker.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(tracker).toContainText('Synthetic Hospital');
  await expect(page.locator('#mapContainer .cyber-map-incident')).toHaveCount(2);
});
