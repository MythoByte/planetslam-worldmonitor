import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installSpaceFixtures, spaceFixture } from './space-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam Space feature');
async function boot(page: import('@playwright/test').Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'orbit-acceptance', clearStorage: true, localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await page.goto('/dashboard?variant=space&layers=satellites,spaceports,aurora,webcams');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
}
for (const width of [1440, 390]) {
  test(`satellite selection, search and saved group at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await installSpaceFixtures(page); await boot(page);
    const panel = page.locator('[data-panel="space-satellites"]');
    await expect(async () => { await panel.scrollIntoViewIfNeeded(); await expect(panel.locator('[data-orbit-selected]')).toContainText('25544'); }).toPass({ timeout: 20000 });
    await expect(panel).toContainText(/calculated/i);
    await expect(panel).toContainText(/epoch/i);
    await expect(page.locator('#mapContainer')).toHaveClass(/svg-mode|deckgl-mode|globe-mode/);
    if ((await page.locator('#mapContainer').getAttribute('class'))?.includes('svg-mode')) {
      await expect(page.locator('.space-orbits-overlay .space-orbit-marker.selected')).toHaveCount(1);
      expect(await page.locator('.space-orbits-overlay path').count()).toBeGreaterThan(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`satellites-iss-${width}.png`) });
    await panel.locator('[data-orbit-group]').selectOption('starlink');
    await panel.locator('[data-orbit-search]').fill('100001');
    await panel.locator('[data-orbit-id="100001"]').click();
    await expect(panel.locator('[data-orbit-selected]')).toContainText('100001');
    await expect(panel.locator('[data-orbit-selected]')).toContainText(/STARLINK SYNTHETIC/);
    await page.screenshot({ path: testInfo.outputPath(`satellites-starlink-${width}.png`) });
    await testInfo.attach('Synthetic satellite selection', { path: testInfo.outputPath(`satellites-starlink-${width}.png`), contentType: 'image/png' });
    await page.reload();
    await expect(async () => { await panel.scrollIntoViewIfNeeded(); await expect(panel.locator('[data-orbit-selected]')).toContainText('100001'); }).toPass({ timeout: 20000 });
    await expect(panel.locator('[data-orbit-group]')).toHaveValue('starlink');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
test('unavailable orbit source recovers without showing fabricated positions', async ({ page }) => {
  await installSpaceFixtures(page, { orbits: { status: 'unavailable', data: null, message: 'Synthetic orbit provider outage' } });
  await boot(page);
  const panel = page.locator('[data-panel="space-satellites"]');
  await expect(async () => { await panel.scrollIntoViewIfNeeded(); await expect(panel).toContainText(/unavailable|outage/i); }).toPass({ timeout: 20000 });
  await expect(panel.locator('.space-orbit-metrics')).toHaveCount(0);
  await page.route('**/api/space?dataset=orbits', route => route.fulfill({ json: spaceFixture('orbits') }));
  await panel.getByRole('button', { name: /refresh catalog/i }).click();
  await expect(panel.locator('[data-orbit-selected]')).toContainText('25544');
});

test('existing Space layouts gain the tracker while explicit hidden panels stay hidden', async ({ page }) => {
  await installSpaceFixtures(page);
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'existing-space-profile', clearStorage: true, localStorage: {
    'worldmonitor-panel-layout-variant': 'space',
    'worldmonitor-panels': JSON.stringify({ 'space-news': { name: 'Space News', enabled: false, priority: 1 }, 'space-cameras': { name: 'Space Live', enabled: true, priority: 1 } }),
  } } });
  await page.goto('/dashboard?variant=space&layers=satellites,spaceports,aurora,webcams');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  const panel = page.locator('[data-panel="space-satellites"]');
  await expect(async () => { await panel.scrollIntoViewIfNeeded(); await expect(panel.locator('[data-orbit-selected]')).toContainText('25544'); }).toPass({ timeout: 20000 });
  await expect(page.locator('[data-panel="space-news"]')).toBeHidden();
});
