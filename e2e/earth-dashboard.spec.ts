import { test, expect, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installEarthFixtures } from './earth-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'Earth is a PlanetSlam edition');
const panel = (page: Page, name: string) => page.locator(`#panelsGrid [data-panel="earth-${name}"]`);
async function boot(page: Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'earth-acceptance', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await page.goto('/dashboard?variant=earth');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  await expect(page).toHaveTitle(/PlanetSlam Earth/);
}
async function mounted(page: Page, name: string, text: string) {
  await expect(async () => { await panel(page, name).scrollIntoViewIfNeeded(); await expect(panel(page, name)).toContainText(text); }).toPass({ timeout: 20000 });
}
for (const width of [1440, 390]) {
  test(`Earth hazards, news, camera context and persistence at ${width}px`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 }); await installEarthFixtures(page); await boot(page);
    await mounted(page, 'events', 'Synthetic Pacific earthquake');
    await page.screenshot({ path: info.outputPath(`earth-overview-${width}.png`) });
    await panel(page, 'events').getByLabel('Hazard', { exact: true }).selectOption('volcano');
    await expect(panel(page, 'events')).not.toContainText('Synthetic Pacific earthquake');
    await panel(page, 'events').getByRole('button', { name: 'Details: Synthetic Kīlauea activity', exact: true }).click();
    await expect(panel(page, 'events').getByRole('region', { name: 'Selected Earth event' })).toContainText('Synthetic volcano agency update');
    await expect(panel(page, 'events').locator('script')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`earth-event-${width}.png`) });
    await panel(page, 'events').getByRole('button', { name: 'Nearby webcams', exact: true }).click();
    await mounted(page, 'cameras', 'Cameras within 250 km');
    await expect(panel(page, 'cameras')).toContainText('Kīlauea');
    await expect(panel(page, 'cameras').locator('iframe, img')).toHaveCount(0);
    await panel(page, 'cameras').getByRole('button', { name: 'Show all cameras', exact: true }).click();
    await panel(page, 'cameras').getByLabel('Camera type', { exact: true }).selectOption('river');
    await expect(panel(page, 'cameras')).toContainText('Colorado River');
    await expect(panel(page, 'cameras')).not.toContainText('Kīlauea');
    await panel(page, 'cameras').locator('[data-earth-camera-favorite="paria-colorado"]').click();
    expect(await page.evaluate(() => localStorage.getItem('planetslam-earth-camera-favorites-v1'))).toContain('paria-colorado');
    await page.route('https://www.nps.gov/webcams-glca/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#254c57"/><text x="20" y="160" fill="white">SYNTHETIC CAMERA ACCEPTANCE IMAGE</text></svg>' }));
    await panel(page, 'cameras').getByRole('button', { name: 'Load snapshot', exact: true }).click();
    await expect(panel(page, 'cameras')).toContainText('Snapshot loaded');
    await page.screenshot({ path: info.outputPath(`earth-camera-${width}.png`) });
    await panel(page, 'cameras').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(panel(page, 'cameras').locator('img')).toHaveCount(0);
    await mounted(page, 'news', 'Synthetic flood reporting');
    await panel(page, 'news').getByLabel('News source', { exact: true }).selectOption('official');
    await expect(panel(page, 'news')).not.toContainText('Synthetic flood reporting');
    await expect(panel(page, 'news')).toContainText('Synthetic volcano agency update');
    await mounted(page, 'weather', 'MET Norway modelled conditions');
    await panel(page, 'weather').getByLabel('Weather location', { exact: true }).selectOption('tokyo');
    await expect(panel(page, 'weather').getByRole('heading', { name: 'Tokyo', exact: true })).toBeVisible();
    await mounted(page, 'alerts', 'Synthetic flood warning');
    await mounted(page, 'rivers', 'Synthetic Pittsburgh gauge');
    await mounted(page, 'airquality', 'Synthetic city');
    await mounted(page, 'health', 'Retrieval health');
    await page.locator('#mapContainer').scrollIntoViewIfNeeded();
    const map = page.getByTestId('earth-map-controls'); await expect(map).toBeVisible();
    if (!(await map.evaluate(element => (element as HTMLDetailsElement).open))) await map.locator('summary').first().click();
    await map.getByLabel('Inspect Earth location', { exact: true }).selectOption('event:fixture-volcano');
    await expect(map.getByRole('region', { name: 'Selected map location' })).toContainText('Synthetic Kīlauea activity');
    await map.locator('.earth-map-layer-options > summary').click();
    await map.getByLabel('Wildfires', { exact: true }).uncheck();
    expect(await page.evaluate(() => localStorage.getItem('planetslam-earth-map-v1'))).not.toContain('wildfire');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`earth-map-${width}.png`) });
    await page.screenshot({ path: info.outputPath(`earth-full-${width}.png`), fullPage: true });
    await page.reload(); await mounted(page, 'cameras', 'Earth');
    await expect(panel(page, 'cameras').locator('[data-earth-camera-favorite="paria-colorado"]')).toHaveAttribute('aria-pressed', 'true');
    if (width >= 1000) {
      await page.locator('[data-variant="space"]').first().click(); await expect(page).toHaveTitle(/PlanetSlam Space/);
      await page.locator('[data-variant="earth"]').first().click(); await expect(page).toHaveTitle(/PlanetSlam Earth/);
      await page.locator('[data-variant="cyber"]').first().click(); await expect(page).toHaveTitle(/PlanetSlam Cyber/);
    }
    expect(errors).toEqual([]);
  });
}
test('Earth outage labels and retry recover without inventing an all-clear', async ({ page }, info) => {
  await installEarthFixtures(page, { events: { status: 'stale', message: 'Synthetic event provider delay.' }, alerts: { status: 'unavailable', data: null, message: 'Synthetic alert provider outage.' } });
  await boot(page); await mounted(page, 'events', 'Synthetic event provider delay.');
  await expect(panel(page, 'events')).toContainText('Delayed · last known data');
  await mounted(page, 'alerts', 'Synthetic alert provider outage.');
  await page.screenshot({ path: info.outputPath('earth-outage.png') });
  await installEarthFixtures(page);
  await panel(page, 'alerts').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page, 'alerts')).toContainText('Synthetic flood warning');
});

test('Earth replays a deferred camera selection and recovers an offline snapshot', async ({ page }, info) => {
  await installEarthFixtures(page); await boot(page);
  const controls = page.getByTestId('earth-map-controls'); await controls.locator('summary').first().click();
  await expect(page.locator('#country-deep-dive-panel')).not.toBeVisible();
  await controls.getByLabel('Inspect Earth location', { exact: true }).selectOption('camera:paria-colorado');
  await mounted(page, 'cameras', 'Colorado River');
  const camera = panel(page, 'cameras').locator('[data-earth-camera="paria-colorado"]');
  await expect(camera).toBeFocused();
  await expect(camera.locator('img')).toHaveCount(0);
  await page.route('https://www.nps.gov/webcams-glca/**', route => route.abort('failed'));
  await camera.getByRole('button', { name: 'Load snapshot', exact: true }).click();
  await expect(camera).toContainText('Snapshot unavailable');
  await page.screenshot({ path: info.outputPath('earth-camera-offline.png') });
  await page.route('https://www.nps.gov/webcams-glca/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><text x="20" y="100">SYNTHETIC RECOVERED SNAPSHOT</text></svg>' }));
  await camera.getByRole('button', { name: 'Reconnect camera', exact: true }).click();
  await expect(camera).toContainText('Snapshot loaded');
  const marker = page.locator('[data-earth-marker="fixture-volcano"]');
  if (await marker.count()) {
    await marker.press('Enter');
    await mounted(page, 'events', 'Related reporting');
    await expect(panel(page, 'events').getByRole('region', { name: 'Selected Earth event' })).toContainText('Synthetic Kīlauea activity');
  }
});

for (const width of [1440, 390]) {
  test(`Earth extended hazards and recorded history at ${width}px`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await installEarthFixtures(page); await boot(page);
    await mounted(page, 'alerts', 'Synthetic heat warning');
    const alerts = panel(page, 'alerts');
    await alerts.locator('.earth-hazard-browse > summary').click();
    await alerts.locator('[data-earth-browse="hail"]').click();
    await expect(alerts.getByLabel('Hazard', { exact: true })).toHaveValue('hail');
    await expect(alerts).toContainText('Synthetic severe thunderstorm with hail');
    await expect(alerts).not.toContainText('Synthetic heat warning');
    await alerts.getByRole('button', { name: 'Details: Synthetic severe thunderstorm with hail', exact: true }).click();
    await expect(alerts.getByRole('region', { name: 'Selected Earth event' })).toContainText('Hail threats');
    await page.screenshot({ path: info.outputPath(`earth-phase4-hazards-${width}.png`) });
    await page.locator('#mapContainer').scrollIntoViewIfNeeded();
    const map = page.getByTestId('earth-map-controls');
    await map.locator('summary').first().click();
    await map.getByRole('button', { name: 'Explore event history', exact: true }).click();
    const history = map.getByRole('region', { name: 'Earth event history' });
    await expect(history).toContainText('Historical snapshots · not current alerts');
    await expect(history).toContainText('3 recorded states');
    const inspect = map.getByLabel('Inspect Earth location', { exact: true });
    await expect(inspect.locator('option')).toHaveText(['Choose an event…', 'flood: Synthetic expired flood warning']);
    await history.getByText('Recorded events (2)', { exact: true }).click();
    await expect(history).toContainText('Synthetic unmapped landslide record');
    await expect(history).toContainText('no map coordinates');
    await inspect.selectOption('event:past-flood');
    await expect(map.getByRole('region', { name: 'Selected map location' })).toContainText('Historical record');
    await expect(map.getByRole('region', { name: 'Selected map location' })).toContainText('original expiry');
    const slider = map.getByLabel('Recorded snapshot', { exact: true });
    await slider.focus(); await slider.press('ArrowRight');
    await expect(slider).toHaveValue('1');
    await expect(inspect.locator('option')).toHaveCount(1);
    await history.getByText('Sources at this recorded time', { exact: true }).click();
    await expect(history).toContainText('unavailable');
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('2');
    await expect(history).toContainText('capacity limited');
    await inspect.selectOption('event:past-coastal');
    await expect(map.getByRole('region', { name: 'Selected map location' })).toContainText('Synthetic coastal snapshot');
    await map.scrollIntoViewIfNeeded();
    await map.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath(`earth-phase4-history-${width}.png`) });
    await map.getByRole('button', { name: 'Play history', exact: true }).click();
    await expect(slider).toHaveValue('0');
    await expect(slider).toHaveValue('1');
    await expect(map.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
    await map.getByRole('button', { name: 'Pause playback', exact: true }).click();
    await map.getByRole('button', { name: 'Return to current events', exact: true }).click();
    await expect(map.getByRole('region', { name: 'Earth event history' })).toHaveCount(0);
    await expect(inspect.locator('option[value="event:fixture-volcano"]')).toHaveCount(1);
    await expect(inspect.locator('option[value="event:past-flood"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Earth history commissioning and retry never reuse current events as past records', async ({ page }, info) => {
  await installEarthFixtures(page, { history: { status: 'unavailable', data: { items: [], events: [] }, fetchedAt: null, expiresAt: null } });
  await boot(page);
  const map = page.getByTestId('earth-map-controls');
  await map.locator('summary').first().click();
  await map.getByRole('button', { name: 'Explore event history', exact: true }).click();
  await expect(map).toContainText('History begins when the upgraded worker runs');
  await expect(map.getByLabel('Inspect Earth location', { exact: true }).locator('option')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('earth-phase4-uncommissioned.png') });
  await installEarthFixtures(page);
  await map.getByRole('button', { name: 'Reload recorded history', exact: true }).click();
  await expect(map.getByRole('region', { name: 'Earth event history' })).toContainText('3 recorded states');
  await expect(map.getByLabel('Inspect Earth location', { exact: true }).locator('option[value="event:past-flood"]')).toHaveCount(1);
});
