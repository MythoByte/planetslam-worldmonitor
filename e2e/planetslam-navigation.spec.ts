import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam navigation only');

for (const width of [1440, 900, 390]) {
  test(`simplified navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-navigation', clearStorage: true, localStorage: {
        'mobile-map-collapsed': 'false',
      } },
    });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
    const picker = page.locator('.ps-dashboard-picker');
    await expect(picker.locator('summary')).toContainText('World');
    await expect(page.locator('#regionSelect')).toHaveCount(1);
    await expect(page.locator('.map-header-actions #regionSelect')).toBeAttached();
    await expect(page.locator('#panelTabsMount #missionPresetBtn')).toHaveCount(0);
    await expect(page.locator('#missionPresetBtn')).toContainText('Presets');
    if (width > 768) {
      await expect(page.locator('#mobileTabBar')).toBeHidden();
      await expect(page.locator('.header #regionSelect, .header #missionPresetBtn')).toHaveCount(0);
      for (const link of await picker.locator('.variant-option').all()) await expect(link).toBeHidden();
      await picker.locator('summary').click();
      await expect(picker.locator('.variant-option')).toHaveText([/🌍\s+world/i, /💻\s+tech/i, /📈\s+finance/i, /⛏️\s+Commodities/, /⚡\s+energy/i, /☀️\s+Good News/]);
      await page.screenshot({ animations: 'disabled', path: `/tmp/ps-nav-dashboards-${width}.png` });
      await picker.locator('summary').press('Escape');
      await expect(picker).not.toHaveAttribute('open');
      await page.locator('.ps-more > summary').click();
      await expect(page.locator('#copyLinkBtn')).toBeVisible();
      await expect(page.locator('#psMoreActions .export-panel-container')).toBeAttached();
      await page.screenshot({ animations: 'disabled', path: `/tmp/ps-nav-more-${width}.png` });
      await page.locator('#psMoreActions .export-btn').click();
      await expect(page.locator('#psMoreActions .export-menu')).toBeVisible();
      await page.locator('.ps-more > summary').press('Escape');
      await page.locator('#regionSelect').selectOption('eu');
      await expect(page.locator('#regionSelect')).toHaveValue('eu');
      await page.locator('#missionPresetBtn').click();
      await expect(page.locator('.mission-preset-popover')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.locator('.intel-findings-badge').click();
      await expect(page.locator('.intel-findings-dropdown')).toHaveClass(/open/);
      await page.keyboard.press('Escape');
      await page.locator('#unifiedSettingsBtn').click();
      await expect(page.locator('.unified-settings-modal')).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      await expect(page.locator('#mobileTabBar')).toBeVisible();
      await page.locator('#mobileTabBar [data-mobile-tab="more"]').click();
      await expect(page.locator('#mobileMenu')).toHaveClass(/open/);
      await expect(page.locator('#mobileMenuMission')).toContainText('Presets');
      await expect(page.locator('#mobileMenu .mobile-menu-variant')).toHaveCount(6);
      await page.screenshot({ animations: 'disabled', path: `/tmp/ps-nav-mobile-more-${width}.png` });
      await page.locator('#mobileMenuClose').click();
      await expect(page.locator('#mobileMenu')).not.toHaveClass(/open/);
      await page.locator('#mobileMenu').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      await expect(page.locator('.ps-mobile-dashboard')).toHaveText('World');
    }
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await page.screenshot({ animations: 'disabled', path: `/tmp/ps-nav-${width}.png` });
    if (width > 768) {
      await picker.locator('summary').click();
      await picker.locator('[data-variant="tech"]').click();
      await expect(picker.locator('summary')).toContainText('Tech', { timeout: 60_000 });
    } else {
      await page.locator('#mobileTabBar [data-mobile-tab="more"]').click();
      await page.locator('#mobileMenu [data-variant="tech"]').click();
      await expect(page.locator('.ps-mobile-dashboard')).toHaveText('Tech', { timeout: 60_000 });
    }
    await expect(page).toHaveURL(/variant=tech/);
  });
}
