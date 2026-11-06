import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

const branded = process.env.VITE_BRAND === 'planetslam';

for (const width of [1440, 768, 390]) {
  test(`foundation: anonymous dashboard at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-profile', clearStorage: true, localStorage: {
        'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false',
        'worldmonitor-panels': JSON.stringify({ politics: { name: 'World News', enabled: true, priority: 0 }, 'stock-analysis': { name: 'Stock Analysis', enabled: true, priority: 1 }, 'latest-brief': { name: 'Latest Brief', enabled: true, priority: 1 } }),
      } },
    });
    // Exercise the brand policy with no remembered dismissal.
    await page.addInitScript(() => localStorage.removeItem('wm-pro-banner-launched-dismissed'));
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
    if (branded) {
      await expect(page.locator('.auth-signin-btn:visible, .auth-signup-link:visible, .mobile-auth-fallback:visible')).toHaveCount(0);
      await expect(page.locator('.pro-banner')).toHaveCount(0);
      await expect(page.locator('#panelsGrid [data-panel="stock-analysis"], #panelsGrid [data-panel="latest-brief"]')).toHaveCount(0);
      await expect(page.locator('.mobile-panel-nav-chip-pro')).toHaveCount(0);
      await expect(page.locator('.ai-widget-block-pro')).toBeHidden();
      await expect(page.locator('html')).not.toHaveClass(/wm-pro-banner-reserved/);
    }
    if (branded) await expect(page.locator('html')).toHaveAttribute('data-brand', 'planetslam');
    else expect(await page.locator('html').getAttribute('data-brand')).toBeNull();
    await expect(page.locator('#mapContainer')).toHaveClass(/deckgl-mode|svg-mode/, { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `docs/planetslam/evidence/${branded ? 'planetslam' : 'upstream'}-${width}-dark.png` });
    const openSettings = async () => {
      if (width <= 768) {
        await page.locator('[data-mobile-tab="more"]').click();
        if (branded) {
          await expect(page.locator('.auth-signin-btn:visible, .auth-signup-link:visible, .mobile-auth-fallback:visible')).toHaveCount(0);
          await expect.poll(() => page.locator('#mobileMenu').evaluate(el => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(-1);
          await page.screenshot({ path: `docs/planetslam/evidence/planetslam-${width}-menu.png` });
        }
        await page.locator('#mobileMenuSettings').click();
      } else await page.locator('#unifiedSettingsBtn').click();
    };
    await openSettings();
    await expect(page.locator('#us-theme')).toBeVisible();
    if (branded) {
      await expect(page.locator('.upgrade-pro-section')).toHaveCount(0);
      await page.locator('#us-tab-panels').click();
      await expect(page.locator('#usPanelToggles [data-panel="stock-analysis"], #usPanelToggles [data-panel="latest-brief"]')).toHaveCount(0);
      await page.screenshot({ path: `docs/planetslam/evidence/planetslam-${width}-panels.png` });
      await page.locator('#us-tab-settings').click();
    }
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

for (const width of [1440, 390]) {
  test(`source availability: hides and restores modules at ${width}px`, async ({ page }, testInfo) => {
    test.skip(!branded, 'PlanetSlam-only visibility policy');
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-source-profile', clearStorage: true, localStorage: {
        'mobile-map-collapsed': 'false',
        'worldmonitor-panels': JSON.stringify({
          climate: { name: 'Climate Anomalies', enabled: true, priority: 0 },
          politics: { name: 'World News', enabled: true, priority: 0 },
        }),
        'panel-order': JSON.stringify(['climate', 'politics']),
      } },
    });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    let available = true;
    let healthRequests = 0;
    await page.route('**/api/health?*', route => {
      healthRequests++;
      return route.fulfill({ json: {
        status: available ? 'OK' : 'DEGRADED',
        checkedAt: new Date().toISOString(),
        checks: {
          climateAnomalies: { status: available ? 'OK' : 'EMPTY_DATA', records: 0, seedAgeMin: 0 },
          climateDisasters: { status: available ? 'OK' : 'EMPTY_DATA', records: 0, seedAgeMin: 0 },
          climateAirQuality: { status: available ? 'OK' : 'EMPTY_DATA', records: 0, seedAgeMin: 0 },
        },
      } });
    });
    await page.clock.install();
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => healthRequests, { timeout: 60_000 }).toBeGreaterThan(0);
    const climate = page.locator('#panelsGrid .panel[data-panel="climate"]');
    await expect(climate).toBeAttached({ timeout: 60_000 });
    await climate.scrollIntoViewIfNeeded();
    await expect(climate).toBeVisible();
    await expect(climate.locator('.panel-empty')).toBeVisible();
    await page.screenshot({ path: `docs/planetslam/evidence/planetslam-${width}-source-working.png` });

    const initialRequests = healthRequests;
    available = false;
    await page.clock.fastForward(301_000);
    await expect.poll(() => healthRequests).toBeGreaterThan(initialRequests);
    await expect(climate).toHaveClass(/panel-source-unavailable/);
    await expect(climate).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-panels')!).climate.enabled)).toBe(true);
    await page.screenshot({ path: `docs/planetslam/evidence/planetslam-${width}-source-unavailable.png` });

    if (width <= 768) {
      await page.locator('[data-mobile-tab="more"]').click();
      await page.locator('#mobileMenuSettings').click();
    } else await page.locator('#unifiedSettingsBtn').click();
    await page.locator('#us-tab-panels').click();
    const climateSetting = page.locator('#usPanelToggles [data-panel="climate"]');
    await expect(climateSetting).toHaveCount(0);

    const failedRequests = healthRequests;
    available = true;
    await page.clock.fastForward(301_000);
    await expect.poll(() => healthRequests).toBeGreaterThan(failedRequests);
    await expect(climate).not.toHaveClass(/panel-source-unavailable/);
    await expect(climateSetting).toHaveCount(1);
    await page.locator('.unified-settings-close').click();
    await expect(climate).toBeVisible();
    await page.screenshot({ path: `docs/planetslam/evidence/planetslam-${width}-source-restored.png` });
    await testInfo.attach('source-availability', { body: JSON.stringify({ width, healthRequests, controlledHealthResponses: true }), contentType: 'application/json' });
  });
}
