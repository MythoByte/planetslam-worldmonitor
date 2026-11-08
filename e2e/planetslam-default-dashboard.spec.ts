import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam default dashboard only');

for (const width of [1440, 390]) {
  test(`world dashboard opens directly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-default-dashboard', clearStorage: true, localStorage: {
        'mobile-map-collapsed': 'false',
        'planetslam-home-collapsed-v1': JSON.stringify({ politics: true }),
      } },
    });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    for (const path of ['/', '/dashboard']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
      await expect(page.locator('#mapContainer')).toHaveClass(/deckgl-mode|svg-mode/, { timeout: 60_000 });
      await expect(page.locator('#panelsGrid .panel').first()).toBeAttached();
      await expect(page.locator('#unifiedSettingsBtn')).toBeAttached();
      await expect(page.locator('html')).not.toHaveAttribute('data-ps-home', 'true');
      await expect(page.locator('.ps-header, .ps-intro, .ps-module')).toHaveCount(0);
      if (path === '/') await page.screenshot({ path: `/tmp/planetslam-default-dashboard-${width}.png` });
    }
  });
}
