import { test, expect } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installSpaceFixtures } from './space-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam Global Space integration');
const ids = ['brief', 'satellites', 'observing', 'cameras', 'launches', 'missions', 'weather', 'apod', 'news', 'spacex', 'neo', 'solar', 'events', 'health'];
for (const width of [1440, 390]) {
  test(`Global Space blocks and layers toggle without duplication at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'global-space', clearStorage: true,
      localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
    await installSpaceFixtures(page);
    await page.goto('/dashboard?variant=full&layers=satellites,spaceports,webcams');
    await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    for (const id of ids) await expect(page.locator(`#panelsGrid [data-panel="space-${id}"]`)).toHaveCount(1);
    const controls = page.getByTestId('space-map-controls');
    await expect(controls).toHaveCount(1);
    await controls.locator('summary').click();
    await expect(controls).toContainText('Aurora: fresh');
    expect(new Set(await controls.locator('.space-layer-icon').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')))).size).toBe(2);
    await expect(page.locator('.space-forecast-overlay circle').first()).toBeAttached();
    await page.getByLabel('Aurora forecast', { exact: true }).uncheck();
    await expect(page.locator('.space-forecast-overlay circle')).toHaveCount(0);
    await page.getByLabel('Upcoming launch sites', { exact: true }).uncheck();
    await expect(page.locator('.space-forecast-overlay image')).toHaveCount(0);
    await page.getByLabel('Aurora forecast', { exact: true }).check();
    await expect(page.locator('.space-forecast-overlay circle').first()).toBeAttached();
    for (const key of ['satellites', 'spaceports', 'webcams']) {
      const toggle = page.locator(`.layer-toggle[data-layer="${key}"]`);
      await expect(toggle).toHaveCount(1);
      await toggle.click();
      await expect(toggle).not.toHaveClass(/active/);
      await toggle.click();
      await expect(toggle).toHaveClass(/active/);
    }
    await page.locator('#mapContainer').screenshot({ path: info.outputPath(`global-space-map-${width}.png`) });
    const apod = page.locator('#panelsGrid [data-panel="space-apod"]');
    await expect(async () => { await apod.scrollIntoViewIfNeeded(); await expect(apod).toContainText('Synthetic nebula acceptance image'); }).toPass();
    for (const id of ids) {
      const block = page.locator(`#panelsGrid [data-panel="space-${id}"]`);
      await expect(async () => { await block.scrollIntoViewIfNeeded(); await expect(block.locator('.space-panel-icon')).toHaveCount(1); }).toPass();
    }
    expect(new Set(await page.locator('.space-panel-icon').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')))).size).toBe(ids.length);
    await apod.scrollIntoViewIfNeeded();
    await apod.screenshot({ path: info.outputPath(`global-space-block-${width}.png`) });
    await page.locator('#unifiedSettingsBtn').click();
    await page.locator('#us-tab-panels').click();
    const row = page.locator('#usPanelToggles .panel-toggle-item[data-panel="space-apod"]');
    await expect(row).toHaveCount(1);
    await row.click();
    await page.locator('.panels-save-layout').click();
    await page.locator('.unified-settings-close').click();
    await expect(apod).not.toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    await expect(apod).not.toBeVisible();
    await expect(page.getByLabel('Upcoming launch sites', { exact: true })).not.toBeChecked();
    await page.locator('#unifiedSettingsBtn').click();
    await page.locator('#us-tab-panels').click();
    await page.locator('#usPanelToggles .panel-toggle-item[data-panel="space-apod"]').click();
    await page.locator('.panels-save-layout').click();
    await page.locator('.unified-settings-close').click();
    await expect(apod).toHaveCount(1);
  });
}
