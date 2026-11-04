import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

const branded = process.env.VITE_BRAND === 'planetslam';

for (const width of [1440, 768, 390]) {
  test(`foundation: anonymous dashboard at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-profile', clearStorage: true, localStorage: {
        'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false',
        'worldmonitor-panels': JSON.stringify({ politics: { name: 'World News', enabled: true, priority: 0 } }),
      } },
    });
    // Controlled UI acceptance, deliberately separate from live-feed validation.
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    await page.route('**/api/news/v1/list-feed-digest*', route => route.fulfill({ json: {
      categories: { politics: { items: [{ source: 'Acceptance fixture', title: 'Test bulletin: source attribution and panel layout', link: 'https://example.com/bulletin', publishedAt: Date.now(), isAlert: false }] } },
      feedStatuses: {}, generatedAt: new Date().toISOString(),
    } }));
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
    await expect(page.locator('#panelsGrid .panel').first()).toBeVisible();
    await expect(page.locator(width <= 768 ? '.logo-mobile' : '.logo')).toHaveText(branded ? (width <= 768 ? 'PlanetSlam' : 'PLANETSLAM') : (width <= 768 ? 'World Monitor' : 'MONITOR'));
    if (branded) await expect(page.locator('html')).toHaveAttribute('data-brand', 'planetslam');
    else expect(await page.locator('html').getAttribute('data-brand')).toBeNull();
    await expect(page.locator('#mapContainer')).toHaveClass(branded ? /globe-mode/ : /deckgl-mode|svg-mode/, { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `docs/planetslam/evidence/${branded ? 'planetslam' : 'upstream'}-${width}-dark.png` });
    const openSettings = async () => {
      if (width <= 768) {
        await page.locator('[data-mobile-tab="more"]').click();
        await page.locator('#mobileMenuSettings').click();
      } else await page.locator('#unifiedSettingsBtn').click();
    };
    await openSettings();
    await expect(page.locator('#us-theme')).toBeVisible();
    await page.selectOption('#us-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('worldmonitor-theme'))).toBe('light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#panelsGrid .panel').first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `docs/planetslam/evidence/${branded ? 'planetslam' : 'upstream'}-${width}-light.png` });
    await openSettings();
    await page.selectOption('#us-theme', 'auto');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('worldmonitor-theme'))).toBe('auto');
    await testInfo.attach('viewport', { body: JSON.stringify({ width, branded, controlledResponses: true }), contentType: 'application/json' });
  });
}
