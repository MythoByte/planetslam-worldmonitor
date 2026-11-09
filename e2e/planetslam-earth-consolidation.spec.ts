import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installEarthFixtures } from './earth-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam Earth consolidation');
const earthIds = ['watch', 'events', 'alerts', 'weather', 'news', 'cameras', 'rivers', 'airquality', 'health'];
for (const width of [1440, 390]) {
  test(`Global retains Earth features and retires Space/Earth menus at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'earth-global', clearStorage: true,
      localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
    await installEarthFixtures(page);
    await page.goto('/dashboard?variant=earth&layers=natural,weather,webcams,fires&timeRange=48h');
    await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    await expect(page).toHaveURL(/variant=full/);
    await expect(page).toHaveURL(/timeRange=48h/);
    await expect(page.locator('[data-variant="earth"], [data-variant="space"], [data-variant="cyber"]')).toHaveCount(0);
    for (const id of earthIds) await expect(page.locator(`#panelsGrid [data-panel="earth-${id}"]`)).toHaveCount(1);
    for (const key of ['natural', 'weather', 'webcams', 'fires']) await expect(page.locator(`.layer-toggle[data-layer="${key}"]`)).toHaveCount(1);
    const volcano = page.locator('[data-earth-marker="fixture-volcano"]');
    const camera = page.locator('[data-earth-marker="paria-colorado"]');
    await expect(volcano).toHaveCount(1);
    await expect(camera).toHaveCount(1);
    await page.locator('.layer-toggle[data-layer="natural"]').click(); await expect(volcano).toHaveCount(0);
    await page.locator('.layer-toggle[data-layer="natural"]').click(); await expect(volcano).toHaveCount(1);
    await page.locator('.layer-toggle[data-layer="webcams"]').click(); await expect(camera).toHaveCount(0);
    await page.locator('.layer-toggle[data-layer="webcams"]').click(); await expect(camera).toHaveCount(1);
    const fire = page.locator('[data-earth-marker="fixture-fire"]');
    await expect(fire).toHaveCount(1);
    await page.locator('.layer-toggle[data-layer="fires"]').click(); await expect(fire).toHaveCount(0);
    await page.locator('.layer-toggle[data-layer="fires"]').click(); await expect(fire).toHaveCount(1);
    const warning = page.locator('[data-earth-marker="fixture-heat"]');
    await expect(warning).toHaveCount(1);
    await page.locator('.layer-toggle[data-layer="weather"]').click(); await expect(warning).toHaveCount(0);
    await page.locator('.layer-toggle[data-layer="weather"]').click(); await expect(warning).toHaveCount(1);
    const controls = page.getByTestId('earth-map-controls'); await expect(controls).toHaveCount(1);
    await controls.locator('summary').first().click();
    await expect(controls).toContainText('Main Layers controls');
    await controls.locator('[data-earth-history]').click();
    await expect(controls.locator('[data-earth-recorded]')).toBeVisible();
    await controls.locator('[data-earth-current]').click();
    await expect(controls).not.toContainText('Historical snapshots · not current alerts');
    await controls.screenshot({ path: info.outputPath(`global-earth-controls-${width}.png`) });
    const events = page.locator('#panelsGrid [data-panel="earth-events"]');
    await expect(async () => { await events.scrollIntoViewIfNeeded(); await expect(events).toContainText('Synthetic Kīlauea activity'); }).toPass();
    await events.screenshot({ path: info.outputPath(`global-earth-block-${width}.png`) });
    for (const id of earthIds) {
      const panel = page.locator(`#panelsGrid [data-panel="earth-${id}"]`);
      await expect(async () => { await panel.scrollIntoViewIfNeeded(); await expect(panel.locator('.earth-panel-icon')).toHaveCount(1); }).toPass();
    }
    expect(new Set(await page.locator('.earth-panel-icon').evaluateAll(nodes => nodes.map(n => n.getAttribute('src')))).size).toBe(9);
    if (width < 768) { await page.locator('[data-mobile-tab="more"]').click(); await page.locator('#mobileMenuSettings').click(); }
    else await page.locator('#unifiedSettingsBtn').click();
    await page.locator('#us-tab-panels').click();
    await page.locator('#usPanelToggles .panel-toggle-item[data-panel="earth-rivers"]').click();
    await page.locator('.panels-save-layout').click(); await page.locator('.unified-settings-close').click();
    await expect(page.locator('#panelsGrid [data-panel="earth-rivers"]')).not.toBeVisible();
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    await expect(page.locator('#panelsGrid [data-panel="earth-rivers"]')).not.toBeVisible();
    await page.goto('/dashboard?variant=space&layers=spaceports,aurora&timeRange=24h');
    await expect(page).toHaveURL(/variant=full/);
    await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    await expect(page.locator('[data-variant="earth"], [data-variant="space"]')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`global-navigation-${width}.png`) });
  });
}

test('Global deduplicates late native events and shares Earth layer controls on the globe', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'earth-global-globe', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await installEarthFixtures(page);
  let releaseNative!: () => void;
  const nativeReady = new Promise<void>(resolve => { releaseNative = resolve; });
  await page.route('**/api/natural/v1/list-natural-events*', async route => {
    await nativeReady;
    await route.fulfill({ json: { fetchedAt: Date.now(), dataAvailable: true, events: [{
      id: 'fixture-volcano', title: 'Synthetic existing Global volcano', category: 'volcanoes', categoryTitle: 'Volcanoes',
      lat: 19.421, lon: -155.287, date: new Date().toISOString(), closed: false,
    }] } });
  });
  await page.goto('/dashboard?variant=full&layers=natural,weather,webcams,fires&lat=20&lon=-155&zoom=2');
  await expect(page.locator('[data-earth-marker="fixture-volcano"]')).toHaveCount(1);
  releaseNative();
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  await expect(page.locator('[data-earth-marker="fixture-volcano"]')).toHaveCount(0);
  await page.locator('#mapDimensionToggle [data-mode="globe"]').click();
  await expect(page.locator('#mapContainer')).toHaveClass(/globe-mode/);
  const quake = page.locator('#mapContainer .planetslam-layer-marker[title^="Synthetic Pacific earthquake"]');
  await expect(quake).toHaveCount(1);
  const natural = page.locator('.layer-toggle[data-layer="natural"] input');
  await natural.uncheck(); await expect(quake).toHaveCount(0);
  await natural.check(); await expect(quake).toHaveCount(1);
  for (const [key, title] of [['weather', 'Synthetic heat warning'], ['fires', 'Synthetic wildfire observation'], ['webcams', 'Colorado River']] as const) {
    const marker = page.locator(`#mapContainer .planetslam-layer-marker[title*="${title}"]`);
    await expect(marker).toHaveCount(1);
    const toggle = page.locator(`.layer-toggle[data-layer="${key}"] input`);
    await toggle.uncheck(); await expect(marker).toHaveCount(0);
    await toggle.check(); await expect(marker).toHaveCount(1);
  }
  await page.locator('#mapContainer').screenshot({ path: info.outputPath('global-earth-globe.png') });
});
