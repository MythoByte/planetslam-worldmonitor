import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installEarthFixtures } from './earth-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam map details');

test('map details stay reachable together on desktop and mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await seedAnonymousDashboard(page, 'full', { initializeOnce: {
    sessionKey: 'map-details', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false', 'wm-map-provider': 'carto' },
  } });
  await installEarthFixtures(page);
  await page.addInitScript(() => {
    // Allow the real DeckGL renderer to run with Playwright's software WebGL.
    const getParameter = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (parameter) {
      return parameter === 0x9246 ? 'Playwright WebGL' : getParameter.call(this, parameter);
    };
  });
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#12202b' } }] },
  }));
  await page.route('https://api.rainviewer.com/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/commercial-shipping', route => route.fulfill({ json: { available: false, vessels: [] } }));
  await page.route('**/api/attack-reports', route => route.fulfill({ json: { status: 'unavailable', reports: [] } }));
  await page.goto('/dashboard?layers=weather,commercialShipping,attackReports');
  const map = page.locator('#mapContainer');
  await expect(map).toHaveClass(/deckgl-mode/);
  const radar = page.getByTestId('weather-radar-status');
  const shipping = page.locator('.commercial-shipping-status');
  const reports = page.locator('.gdelt-attack-status');
  const earth = page.getByTestId('earth-map-controls');
  await expect(radar).toContainText('Precipitation radar unavailable');
  await expect(shipping).toContainText('Commercial Shipping');
  await reports.locator('summary').click();
  await earth.locator(':scope > summary').click();

  for (const width of [1280, 850, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 780 : 850 });
    for (const control of [reports, earth]) {
      await control.evaluate(element => { element.scrollTop = 0; });
    }
    await page.getByRole('group', { name: 'Map layer details' }).evaluate(element => { element.scrollTop = 0; });
    await page.locator('#mapSection').screenshot({ path: info.outputPath(`map-details-${width}.png`) });
    const mapBottom = await map.evaluate(element => element.getBoundingClientRect().bottom);
    const bounds = await Promise.all([radar, shipping, reports, earth].map(control => control.boundingBox()));
    for (const [index, rect] of bounds.entries()) {
      expect(rect!.y).toBeGreaterThanOrEqual(mapBottom);
      for (const other of bounds.slice(index + 1)) {
        const overlap = rect!.x < other!.x + other!.width && rect!.x + rect!.width > other!.x &&
          rect!.y < other!.y + other!.height && rect!.y + rect!.height > other!.y;
        expect(overlap, `Overlapping controls at ${width}px: ${JSON.stringify({ rect, other })}`).toBe(false);
      }
    }
    await radar.getByRole('button', { name: 'Retry radar' }).click({ trial: true });
    await map.locator('.deckgl-time-slider .time-btn.active').click({ trial: true });
    await reports.getByRole('link', { name: 'Data: The GDELT Project' }).click({ trial: true });
    await earth.locator('[data-earth-history]').click();
    await expect(earth.locator('[data-earth-recorded]')).toBeVisible();
    await earth.locator('[data-earth-current]').click();
  }
});
