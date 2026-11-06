import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installSpaceFixtures } from './space-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'Space is a PlanetSlam edition');

async function boot(page: import('@playwright/test').Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'space-acceptance', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await page.goto('/dashboard?variant=space');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  await expect(page).toHaveTitle(/PlanetSlam Space/);
}

for (const width of [1440, 390]) {
  test(`Space dashboard panels and archive at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await installSpaceFixtures(page);
    await boot(page);
    const panel = (id: string) => page.locator(`#panelsGrid [data-panel="space-${id}"]`);
    await expect(async () => {
      await panel('cameras').scrollIntoViewIfNeeded();
      await expect(panel('cameras').locator('[data-camera-favorite="starbase"]')).toBeVisible();
    }).toPass({ timeout: 15_000 });
    await expect(panel('cameras').locator('iframe')).toHaveCount(0);
    await panel('cameras').locator('[data-camera-favorite="starbase"]').click();
    expect(await page.evaluate(() => localStorage.getItem('planetslam-space-camera-favorites-v1'))).toContain('starbase');
    await page.screenshot({ path: testInfo.outputPath(`space-overview-${width}.png`) });
    for (const id of ['launches', 'weather', 'apod', 'news', 'spacex', 'neo', 'solar', 'events', 'health']) {
      // A viewport scroll replaces a deferred shell with the live panel.
      await expect(async () => {
        await panel(id).scrollIntoViewIfNeeded();
        await expect(panel(id).locator('[data-space-status]').first()).toBeVisible();
      }).toPass({ timeout: 15_000 });
      await expect(panel(id).getByText('Data temporarily unavailable', { exact: true })).toHaveCount(0);
      if (width >= 1000) expect((await panel(id).boundingBox())?.width).toBeGreaterThanOrEqual(240);
    }
    await panel('apod').scrollIntoViewIfNeeded();
    await expect(panel('apod').getByRole('heading', { name: 'Synthetic nebula acceptance image' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`space-apod-${width}.png`) });
    await panel('apod').locator('[data-apod-date="2026-10-01"]').click();
    await expect(panel('apod').getByRole('link', { name: 'Watch today’s video at source' })).toBeVisible();
    await panel('news').scrollIntoViewIfNeeded();
    await panel('news').locator('select').selectOption('spacex|starship|starlink|falcon');
    await expect(panel('news').getByText('SpaceX synthetic acceptance headline')).toBeVisible();
    await expect(panel('news').getByText('Telescope science acceptance headline')).toHaveCount(0);
    await expect(panel('neo')).toContainText('not an impact prediction');
    await page.locator('#mapContainer').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="space-map-controls"]')).toBeVisible();
    await page.locator('[data-testid="space-map-controls"] summary').click();
    await expect(page.locator('[data-testid="space-map-controls"]')).toContainText('Aurora: fresh');
    await page.getByLabel('Aurora forecast', { exact: true }).uncheck();
    expect(await page.evaluate(() => localStorage.getItem('planetslam-space-map-overlays-v1'))).toContain('"aurora":false');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`space-${width}.png`), fullPage: true });
    await testInfo.attach('Space dashboard with synthetic responses', { path: testInfo.outputPath(`space-${width}.png`), contentType: 'image/png' });
    await panel('weather').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`space-weather-${width}.png`) });
    await page.reload();
    await expect(async () => {
      await panel('cameras').scrollIntoViewIfNeeded();
      await expect(panel('cameras').locator('[data-camera-favorite="starbase"]')).toHaveAttribute('aria-pressed', 'true');
    }).toPass({ timeout: 15_000 });
    await expect(page.locator('[data-testid="space-map-controls"] input').first()).not.toBeChecked();
  });
}

test('Space preserves stale observations and shows outages, then recovers', async ({ page }) => {
  await installSpaceFixtures(page, {
    weather: { status: 'stale', message: 'Provider refresh delayed.' },
    apod: { status: 'unavailable', data: null, message: 'NASA provider unavailable.' },
    launches: { status: 'unavailable', data: null },
  });
  await boot(page);
  const apod = page.locator('[data-panel="space-apod"]');
  await apod.scrollIntoViewIfNeeded();
  await expect(apod).toContainText('NASA provider unavailable.');
  await expect(apod).toBeVisible();
  await expect(page.locator('[data-panel="space-weather"]')).toContainText('Stale · last known data');
  await expect(async () => {
    await page.locator('[data-panel="space-spacex"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-panel="space-spacex"]')).toContainText('SpaceX synthetic acceptance headline');
  }).toPass({ timeout: 15000 });
  await installSpaceFixtures(page);
  await apod.scrollIntoViewIfNeeded();
  await apod.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(apod.getByRole('heading', { name: 'Synthetic nebula acceptance image' })).toBeVisible();
  await expect(apod.getByText('NASA provider unavailable.')).toHaveCount(0);
});
