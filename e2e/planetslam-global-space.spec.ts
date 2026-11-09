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
    await page.goto('/dashboard?variant=full&layers=satellites,spaceports,aurora,webcams');
    await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    for (const id of ids) await expect(page.locator(`#panelsGrid [data-panel="space-${id}"]`)).toHaveCount(1);
    const aurora = page.locator('.layer-toggle[data-layer="aurora"]');
    const spaceports = page.locator('.layer-toggle[data-layer="spaceports"]');
    await expect(aurora).toHaveCount(1);
    await expect(aurora).toBeVisible();
    await expect(page.locator('.space-forecast-overlay circle').first()).toBeAttached();
    await expect(page.locator('.space-forecast-overlay image')).toHaveCount(1);
    await aurora.click();
    await expect(page.locator('.space-forecast-overlay circle')).toHaveCount(0);
    await aurora.click();
    await expect(page.locator('.space-forecast-overlay circle').first()).toBeAttached();
    await spaceports.click();
    await expect(page.locator('.space-forecast-overlay image')).toHaveCount(0);
    await expect(page.locator('.spaceport-marker')).toHaveCount(0);
    await spaceports.click();
    await expect(page.locator('.space-forecast-overlay image')).toHaveCount(1);
    await expect(page.locator('.spaceport-marker').first()).toBeAttached();
    await aurora.click();
    for (const key of ['satellites', 'spaceports', 'webcams']) {
      const toggle = page.locator(`.layer-toggle[data-layer="${key}"]`);
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toBeVisible({ timeout: 5000 });
      await toggle.click();
      await expect(toggle).not.toHaveClass(/active/);
      await toggle.click();
      await expect(toggle).toHaveClass(/active/);
    }
    if (width < 768) {
      const sizes = await page.locator('.global-space-layers .layer-toggle-row').evaluateAll(rows => rows
        .filter(row => getComputedStyle(row).display !== 'none')
        .map(row => { const button = row.querySelector('button')!; return { rowFits: row.scrollWidth <= row.clientWidth + 1, labelFits: button.scrollWidth <= button.clientWidth + 1 }; }));
      expect(sizes).toHaveLength(7);
      expect(sizes.every(size => size.rowFits && size.labelFits)).toBe(true);
      await page.locator('.layer-toggle[data-layer="aurora"]').scrollIntoViewIfNeeded();
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
    if (width < 768) {
      await page.locator('[data-mobile-tab="more"]').click();
      await page.locator('#mobileMenuSettings').click();
    } else await page.locator('#unifiedSettingsBtn').click();
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
    await expect(aurora).not.toHaveClass(/active/);
    await expect(page.locator('.space-forecast-overlay circle')).toHaveCount(0);
    if (width < 768) {
      await page.locator('[data-mobile-tab="more"]').click();
      await page.locator('#mobileMenuSettings').click();
    } else await page.locator('#unifiedSettingsBtn').click();
    await page.locator('#us-tab-panels').click();
    await page.locator('#usPanelToggles .panel-toggle-item[data-panel="space-apod"]').click();
    await page.locator('.panels-save-layout').click();
    await page.locator('.unified-settings-close').click();
    await expect(apod).toHaveCount(1);
  });
}


test('Global globe hides both spaceport marker sources and exposes Aurora in its layer selector', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'global-space-globe', clearStorage: true, localStorage: { 'mobile-map-collapsed': 'false' } } });
  await installSpaceFixtures(page);
  await page.goto('/dashboard?variant=full&layers=spaceports,aurora');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  await expect(page.locator('.space-forecast-overlay image')).toHaveCount(1);
  await page.locator('#mapDimensionToggle [data-mode="globe"]').click();
  await expect(page.locator('#mapContainer')).toHaveClass(/globe-mode/);
  const rocketMarkers = page.locator('#mapContainer .planetslam-layer-marker[data-layer-icon="🚀"]');
  await expect(rocketMarkers.first()).toBeAttached();
  const ports = page.locator('.layer-toggle[data-layer="spaceports"] input');
  await ports.uncheck();
  await expect(rocketMarkers).toHaveCount(0);
  await ports.check();
  await expect(rocketMarkers.first()).toBeAttached();
  const aurora = page.locator('.layer-toggle[data-layer="aurora"] input');
  await expect(aurora).toBeVisible();
  await aurora.uncheck();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-layers') ?? '{}').aurora)).toBe(false);
  await page.locator('.planetslam-layer-picker').screenshot({ path: info.outputPath('global-globe-layer-picker.png') });
  const pickerWidth = await page.locator('.planetslam-layer-picker').evaluate(el => el.getBoundingClientRect().width);
  expect(pickerWidth).toBeGreaterThanOrEqual(280);
  await page.locator('#mapContainer').screenshot({ path: info.outputPath('global-globe-spaceports-on.png') });
  await ports.uncheck();
  await expect(rocketMarkers).toHaveCount(0);
  await page.locator('#mapContainer').screenshot({ path: info.outputPath('global-globe-spaceports-off.png') });
  await page.locator('#mapDimensionToggle [data-mode="flat"]').click();
  await expect(page.locator('.space-forecast-overlay image')).toHaveCount(0);
  await expect(page.locator('.spaceport-marker')).toHaveCount(0);
  await expect(page.locator('.space-forecast-overlay circle')).toHaveCount(0);
});


test('Global migrates a saved Aurora disable into its native layer preference', async ({ page }) => {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'global-aurora-preference', clearStorage: true, localStorage: {
    'worldmonitor-panel-layout-variant': 'full',
    'worldmonitor-layers': JSON.stringify({ spaceports: true }),
    'planetslam-space-map-overlays-v1': JSON.stringify({ aurora: false, launches: true }),
  } } });
  await installSpaceFixtures(page);
  await page.goto('/dashboard?variant=full');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  const aurora = page.locator('.layer-toggle[data-layer="aurora"]');
  await expect(aurora).not.toHaveClass(/active/);
  await expect(page.locator('.space-forecast-overlay circle')).toHaveCount(0);
  // The saved partial legacy profile inherits Global defaults. Free a slot
  // through the controls before enabling Aurora on the capped SVG renderer.
  const activeKeys = await page.locator('.layer-toggle.active:not([data-layer="spaceports"])').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-layer')));
  for (const key of activeKeys) await page.locator(`.layer-toggle[data-layer="${key}"]`).click();
  await aurora.click();
  await expect(page.locator('.space-forecast-overlay circle').first()).toBeAttached();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-layers') ?? '{}').aurora)).toBe(true);
});
