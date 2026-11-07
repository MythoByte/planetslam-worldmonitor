import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam homepage only');

for (const width of [1440, 1024, 390]) {
  test(`homepage discovery and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-home-profile', clearStorage: true, localStorage: {
        'mobile-map-collapsed': 'false',
        'worldmonitor-panels': JSON.stringify({
          politics: { name: 'World News', enabled: true, priority: 0 },
          'threat-timeline': { name: 'Threat Timeline', enabled: true, priority: 1 },
          cii: { name: 'Country Instability', enabled: true, priority: 1 },
          'strategic-posture': { name: 'AI Strategic Posture', enabled: true, priority: 1 },
        }),
      } },
    });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    await page.route('**/api/health?*', route => route.fulfill({ json: {
      checkedAt: new Date().toISOString(), checks: { newsInsights: { status: 'OK', records: 6, seedAgeMin: 0 } },
    } }));
    await page.route('**/api/news/v1/list-feed-digest*', route => route.fulfill({ json: {
      categories: { politics: { items: Array.from({ length: 6 }, (_, index) => ({
        source: 'BBC World', title: `Synthetic bulletin ${index + 1}: layout and provenance check`,
        link: `https://example.com/bulletin/${index}`, publishedAt: Date.now(), isAlert: false,
      })) } }, feedStatuses: {}, generatedAt: new Date().toISOString(),
    } }));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-ps-home', 'true', { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Global situation' })).toBeVisible();
    await expect(page.locator('#mapContainer')).toHaveClass(/deckgl-mode|svg-mode/, { timeout: 60_000 });
    await expect(page.locator('.ps-layer-list button').first()).toBeAttached();
    await expect(page.locator('.ps-health')).toContainText('Feed coverage');
    await expect(page.locator('.ps-alerts')).toContainText('not supplied');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 1440) expect(await page.locator('#mapSection').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(650);
    if (width === 1440) {
      const accessibility = await new AxeBuilder({ page }).include('.ps-header').include('.ps-intro').include('.ps-utility').include('.ps-alerts').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(accessibility.violations).toEqual([]);
    }

    const drawer = page.locator('.ps-layer-drawer');
    if (!(await drawer.getAttribute('open') !== null)) await drawer.locator(':scope > summary').click();
    await page.getByRole('searchbox', { name: 'Search map layers' }).fill('conflict');
    const layer = page.locator('.ps-layer-list button[data-layer="conflicts"]');
    await expect(layer).toBeVisible();
    const pressed = await layer.getAttribute('aria-pressed');
    await layer.click();
    await expect(layer).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-layers') || '{}').conflicts)).toBe(pressed !== 'true');
    await expect.poll(() => page.locator('.ps-button-primary').getAttribute('href')).toContain('layers=');
    await layer.click();
    await page.getByRole('searchbox', { name: 'Search map layers' }).fill('');

    const panel = page.locator('[data-panel="politics"].ps-module');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible();
    await expect(panel.locator('.item').first()).toContainText('Synthetic bulletin');
    expect(await page.locator('.ps-header').evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThan(2);
    const workspaceOrder = await page.evaluate(() => localStorage.getItem('panel-order'));
    await page.screenshot({ path: `docs/planetslam/homepage-evidence/home-${width}.png` });
    await panel.getByRole('button', { name: 'Toggle World News' }).click();
    await expect(panel).toHaveClass(/ps-collapsed/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ps-home', 'true');
    await expect(page.locator('[data-panel="politics"].ps-module')).toHaveClass(/ps-collapsed/);
    await page.getByRole('button', { name: 'Reset homepage layout' }).click();
    await expect(page.locator('[data-panel="politics"].ps-module')).not.toHaveClass(/ps-collapsed/);
    expect(await page.evaluate(() => localStorage.getItem('panel-order'))).toBe(workspaceOrder);
    await page.locator('#mapFullscreenBtn').click();
    await expect(page.locator('#mapSection')).toHaveClass(/live-news-fullscreen/);
    expect(await page.locator('#mapSection').evaluate(el => Math.abs(el.getBoundingClientRect().height - innerHeight))).toBeLessThan(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mapSection')).not.toHaveClass(/live-news-fullscreen/);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `docs/planetslam/homepage-evidence/overview-${width}.png` });
    await page.locator('.ps-header').getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible();
    await page.keyboard.press('Escape');
    if (width < 1101) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'PlanetSlam' })).toBeVisible();
    }
    await page.locator(width < 1101 ? '.ps-nav-settings' : '.ps-header > button').filter({ hasText: 'Customize' }).click();
    await expect(page.locator('#us-theme')).toBeVisible();
    await page.locator('.unified-settings-close').click();
    // Exercise network emulation once, after the other viewport contexts have
    // finished: Chromium can broadcast ERR_NETWORK_CHANGED across contexts.
    if (width === 390) {
      await page.context().setOffline(true);
      await expect(page.locator('.ps-health')).toContainText('Offline');
      await page.context().setOffline(false);
    }
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
    await expect(page.locator('.ps-header')).toHaveCount(0);
    await expect(page.locator('#panelsGrid [data-panel="politics"]')).toBeAttached();
  });
}
