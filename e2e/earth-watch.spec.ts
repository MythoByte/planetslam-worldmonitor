import { test, expect, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installEarthFixtures, earthFixture } from './earth-dashboard-fixtures';
import type { EarthDataset, EarthEvent } from '../src/types/earth';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'Earth is a PlanetSlam edition');
const watch = (page: Page) => page.locator('[data-panel="earth-watch"]');
async function boot(page: Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'earth-watch-acceptance', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await page.goto('/dashboard?variant=earth&layers=natural,weather,webcams');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(async () => { await watch(page).scrollIntoViewIfNeeded(); await expect(watch(page).getByLabel('Location name', { exact: true })).toBeVisible(); }).toPass({ timeout: 20000 });
}
async function addPlace(page: Page, name: string, lat: string, lon: string) {
  const panel = watch(page), detail = panel.locator('[data-earth-location-details]');
  if (!(await detail.evaluate(element => (element as HTMLDetailsElement).open))) await detail.locator('summary').click();
  await panel.getByLabel('Location name', { exact: true }).fill(name);
  await panel.getByLabel('Latitude', { exact: true }).fill(lat);
  await panel.getByLabel('Longitude', { exact: true }).fill(lon);
  await panel.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(panel.getByLabel('Saved location', { exact: true }).locator('option:checked')).toHaveText(name);
}
for (const width of [1440, 390]) {
  test(`My Earth saves places, thresholds, brief and deduplicated lifecycle alerts at ${width}px`, async ({ page }, info) => {
    const errors: string[] = [], apiUrls: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/earth?')) apiUrls.push(request.url()); });
    await page.setViewportSize({ width, height: 1000 }); await installEarthFixtures(page);
    let stage = 'baseline'; const now = Date.now();
    const flood: EarthEvent = { id: 'nws:initial', sourceId: 'nws', title: 'Synthetic local flood warning', kind: 'flood', latitude: 40, longitude: -80,
      region: 'North America', severity: 'moderate', status: 'Flood warning', mode: 'warning', observedAt: now - 60_000, expiresAt: now + 3600_000,
      url: 'https://example.com/synthetic/flood', provider: 'Synthetic warning authority', summary: 'Synthetic acceptance record, not an operational warning.', locationApproximate: true };
    const upgraded: EarthEvent = { ...flood, id: 'nws:updated', supersedes: [flood.id], severity: 'severe', observedAt: now - 30_000 };
    const cancel: EarthEvent = { ...upgraded, id: 'nws:cancel', sourceId: 'nws-cancel', lifecycle: 'cancelled', supersedes: [flood.id, upgraded.id], observedAt: now - 10_000,
      title: 'Synthetic cancellation notice', status: 'Cancelled by provider', mode: 'observed', latitude: null, longitude: null, expiresAt: null };
    await page.route('**/api/earth?*', route => {
      const dataset = new URL(route.request().url()).searchParams.get('dataset') as EarthDataset;
      if (stage === 'outage' && ['alerts', 'changes'].includes(dataset)) return route.fulfill({ status: 503, json: { error: 'Synthetic interruption' } });
      const base = earthFixture(dataset);
      if (['alerts', 'earthquakes', 'events', 'changes'].includes(dataset)) {
        const sourceId = dataset === 'alerts' ? 'nws' : dataset === 'earthquakes' ? 'usgs' : dataset === 'events' ? 'eonet' : 'nws-cancel';
        const sources = [{ id: sourceId, provider: 'Synthetic Earth watch source', coverage: 'Synthetic acceptance coverage only', status: dataset === 'alerts' && stage === 'delayed-upgrade' ? 'stale' : 'fresh', fetchedAt: now,
          observedAt: now - 1000, expiresAt: now + 3600_000, staleAt: now + 3600_000 }];
        const items = dataset === 'alerts' ? [stage === 'baseline' ? flood : upgraded]
          : dataset === 'earthquakes' ? [{ ...flood, id: 'usgs:synthetic', sourceId, title: 'Synthetic local earthquake', kind: 'earthquake', severity: 'unknown', magnitude: 4.6, expiresAt: null }]
            : dataset === 'events' ? [{ ...flood, id: 'eonet:unmapped', sourceId, title: 'Synthetic unmapped event', latitude: null, longitude: null }]
              : stage === 'cancelled' ? [cancel] : [];
        return route.fulfill({ json: { ...base, sources, data: { items, sources } } });
      }
      return route.fulfill({ json: base });
    });
    await boot(page);
    await addPlace(page, 'Synthetic home', '40', '-80');
    const panel = watch(page), nearby = panel.getByRole('region', { name: 'Nearby Earth hazards' }), inbox = panel.getByRole('region', { name: 'Earth alert inbox' });
    await expect(nearby).toContainText('Synthetic local flood warning');
    await expect(nearby).toContainText('Synthetic local earthquake');
    await expect(inbox.locator('[data-earth-watch-change]')).toHaveCount(0);
    await expect(panel.getByRole('region', { name: 'Daily Earth brief' })).toContainText('Synthetic home');
    await panel.locator('[data-earth-settings-details] > summary').click();
    await panel.getByLabel('Radius (km)', { exact: true }).fill('50');
    await panel.getByLabel('Minimum severity', { exact: true }).selectOption('moderate');
    await panel.getByLabel('Include unknown severity', { exact: true }).uncheck();
    await panel.getByLabel('Minimum earthquake magnitude', { exact: true }).fill('5');
    await panel.getByRole('button', { name: 'Save alert settings', exact: true }).click();
    await expect(nearby).not.toContainText('Synthetic local earthquake');
    await expect(nearby).toContainText('Synthetic local flood warning');
    stage = 'delayed-upgrade';
    await panel.getByRole('button', { name: 'Refresh Earth watch', exact: true }).click();
    await expect(nearby).toContainText('severe severity');
    await expect(inbox.locator('[data-earth-watch-change]')).toHaveCount(0);
    stage = 'upgraded';
    await panel.getByRole('button', { name: 'Refresh Earth watch', exact: true }).click();
    await expect(inbox.locator('[data-earth-watch-change="escalated"]')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Refresh Earth watch', exact: true }).click();
    await expect(inbox.locator('[data-earth-watch-change]')).toHaveCount(1);
    await panel.scrollIntoViewIfNeeded();
    await panel.locator('.panel-content').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath(`earth-phase5-watch-${width}.png`) });
    stage = 'outage';
    await panel.getByRole('button', { name: 'Refresh Earth watch', exact: true }).click();
    await expect(inbox.locator('[data-earth-watch-change]')).toHaveCount(1);
    await expect(inbox.locator('[data-earth-watch-change="missing"]')).toHaveCount(0);
    stage = 'upgraded';
    await panel.getByRole('button', { name: 'Refresh Earth watch', exact: true }).click();
    await expect(nearby).toContainText('Synthetic local flood warning');
    await expect(inbox.locator('[data-earth-watch-change]')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Clear alert inbox', exact: true }).click();
    await panel.getByRole('button', { name: 'Refresh Earth watch', exact: true }).click();
    await expect(inbox.locator('[data-earth-watch-change]')).toHaveCount(0);
    stage = 'cancelled';
    await panel.getByRole('button', { name: 'Refresh Earth watch', exact: true }).click();
    await expect(inbox.locator('[data-earth-watch-change="cancelled"]')).toHaveCount(1);
    await expect(nearby).not.toContainText('Synthetic local flood warning');
    await expect(inbox).toContainText('does not establish that the area is safe');
    await inbox.locator('[data-earth-watch-change="cancelled"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`earth-phase5-cancellation-${width}.png`) });
    await panel.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(inbox.locator('[data-unread="true"]')).toHaveCount(0);
    await page.reload();
    await expect(async () => { await panel.scrollIntoViewIfNeeded(); await expect(panel.getByLabel('Saved location', { exact: true })).toBeVisible(); }).toPass({ timeout: 20000 });
    await expect(panel.getByLabel('Saved location', { exact: true }).locator('option:checked')).toHaveText('Synthetic home');
    await expect(inbox.locator('[data-earth-watch-change="cancelled"]')).toHaveCount(1);
    await expect(inbox.locator('[data-unread="true"]')).toHaveCount(0);
    await addPlace(page, 'Synthetic equator', '0', '0');
    expect(await page.evaluate(() => localStorage.getItem('planetslam-earth-watch-preferences-v1'))).toContain('Synthetic equator');
    await panel.getByRole('button', { name: 'Center map on saved location', exact: true }).click();
    await panel.scrollIntoViewIfNeeded();
    await panel.getByRole('button', { name: 'Remove saved location', exact: true }).click();
    await expect(panel.getByLabel('Saved location', { exact: true }).locator('option:checked')).toHaveText('Synthetic home');
    expect(apiUrls.every(url => [...new URL(url).searchParams.keys()].every(key => key === 'dataset'))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('geolocation is explicit, handles denial and preserves valid equator coordinates', async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, 'earthLocationRequests', { get: () => calls });
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (success: PositionCallback, error: PositionErrorCallback) => {
      calls += 1;
      if (calls === 1) error({ code: 1 } as GeolocationPositionError);
      else success({ coords: { latitude: 0, longitude: 0 } } as GeolocationPosition);
    } });
  });
  await installEarthFixtures(page); await boot(page);
  expect(await page.evaluate(() => (window as unknown as { earthLocationRequests: number }).earthLocationRequests)).toBe(0);
  await watch(page).getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(watch(page)).toContainText('Location permission was denied');
  await watch(page).getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(watch(page).getByLabel('Latitude', { exact: true })).toHaveValue('0.000000');
  await expect(watch(page).getByLabel('Longitude', { exact: true })).toHaveValue('0.000000');
  await watch(page).getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(watch(page).getByLabel('Saved location', { exact: true }).locator('option:checked')).toHaveText('Current location');
});

test('YouTube live-source filter exposes operator links without loading media', async ({ page }, info) => {
  let youtubeRequests = 0;
  page.on('request', request => { if (/youtube(?:-nocookie)?\.com|ytimg\.com|googlevideo\.com/.test(request.url())) youtubeRequests += 1; });
  await installEarthFixtures(page); await boot(page);
  const cameras = page.locator('[data-panel="earth-cameras"]');
  await expect(async () => { await cameras.scrollIntoViewIfNeeded(); await expect(cameras.getByLabel('Camera media', { exact: true })).toBeVisible(); }).toPass({ timeout: 20000 });
  await cameras.getByLabel('Camera media', { exact: true }).selectOption('youtube');
  await expect(cameras.locator('[data-earth-camera]')).toHaveCount(5);
  await expect(cameras).toContainText('Monterey Bay'); await expect(cameras).toContainText('Reykjanes');
  await expect(cameras.locator('iframe,img')).toHaveCount(0); expect(youtubeRequests).toBe(0);
  await page.screenshot({ path: info.outputPath('earth-phase5-youtube.png') });
  await cameras.getByLabel('Camera media', { exact: true }).selectOption('snapshot');
  await expect(cameras.locator('[data-earth-camera]')).toHaveCount(8);
  await expect(cameras).not.toContainText('Monterey Bay');
});
