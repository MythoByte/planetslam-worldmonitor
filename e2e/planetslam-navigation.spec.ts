import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installCyberFixtures } from './cyber-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam navigation only');

async function choosePreset(page: Page, width: number, id: string) {
  if (width > 768) {
    await page.locator('.ps-dashboard-picker > summary').click();
    await page.locator(`.ps-dashboard-picker [data-variant="${id}"]`).click();
  } else {
    await page.locator('[data-mobile-tab="more"]').click();
    await page.locator(`#mobileMenu [data-variant="${id}"]`).click();
  }
}

for (const width of [1440, 900, 390]) {
  test(`one World workspace with editable dashboard presets at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-navigation', clearStorage: true, localStorage: {
        'mobile-map-collapsed': 'false',
      } },
    });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    await installCyberFixtures(page);
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).presetDocumentSentinel = true; });
    await expect(page.locator('#missionPresetBtn, #mobileMenuMission')).toHaveCount(0);
    const label = page.locator(width > 768 ? '.ps-dashboard-picker > summary' : '.ps-mobile-dashboard');
    for (const [id, name, panel] of [['tech', 'Tech', 'cyber-kev'], ['finance', 'Finance', 'markets'], ['commodity', 'Commodities', 'commodity-news'], ['energy', 'Energy', 'energy-complex'], ['happy', 'Good News', 'positive-feed'], ['full', 'World', 'politics']]) {
      await choosePreset(page, width, id!);
      await expect(label).toContainText(name!);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).presetDocumentSentinel)).toBe(true);
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem('worldmonitor-panels')!)[key]?.enabled, panel!)).toBe(true);
      await expect(page.locator(`[data-panel="${panel}"]`).first()).toBeAttached();
      await expect(page).not.toHaveURL(/variant=|dashboard=/);
    }
    await choosePreset(page, width, 'energy');
    await expect(label).toHaveText(/Energy/);
    if (width > 768) {
      await page.locator('#regionSelect').selectOption('eu');
      await expect(label).toContainText('Custom');
    } else {
      await expect(page.locator('#mobileTabBar')).toBeVisible();
      await expect(page.locator('#mobileTabBar .mobile-tab')).toHaveCount(5);
    }
    // + saves a copy of the current selection; Main keeps the Energy layout.
    if (width > 768) {
      const resize = page.locator('[data-panel="energy-complex"] .panel-resize-handle');
      await resize.press('End');
      await resize.press('Home');
      await expect(label).toContainText('Custom');
    }
    if (width > 768) await page.locator('.dashboard-tab-add').click();
    else {
      await page.locator('[data-mobile-tab="more"]').click();
      await page.locator('#psMobileSavedWorkspaces [data-save-dashboard]').click();
    }
    await expect(page.locator('.dashboard-tab')).toHaveCount(2);
    if (width > 768) {
      await page.locator('[data-panel="energy-complex"] .panel-resize-handle').press('ArrowDown');
    }
    await page.locator('.dashboard-tab.active .dashboard-tab-label').dblclick();
    await page.locator('.dashboard-tab-rename').fill('My energy desk');
    await page.locator('.dashboard-tab-rename').press('Enter');
    await choosePreset(page, width, 'finance');
    await expect(label).toContainText('Finance');
    await page.getByRole('tab', { name: 'Main', exact: true }).click();
    await expect(label).toContainText('Energy');
    await expect(page.locator('#regionSelect')).toHaveValue(width > 768 ? 'eu' : 'global');
    if (width > 768) await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-panel-spans')!)['energy-complex'])).toBe(1);
    // Panels remain freely mixable after applying a preset.
    const settingsButton = width > 768 ? '#unifiedSettingsBtn' : '#mobileMenuSettings';
    if (width <= 768) await page.locator('[data-mobile-tab="more"]').click();
    await page.locator(settingsButton).click();
    await page.locator('#us-tab-panels').click();
    await page.locator('.panel-toggle-item[data-panel="cyber-kev"]').click();
    await page.locator('.panels-save-layout').click();
    await page.locator('.unified-settings-close').click();
    await expect(label).toContainText('Custom');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
    await expect(label).toContainText('Energy');
    await expect(label).toContainText('Custom');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-panels')!)["cyber-kev"].enabled)).toBe(true);
    if (width > 768) {
      await page.locator('.ps-dashboard-picker > summary').click();
      await expect(page.locator('#psSavedWorkspaces')).toContainText('My energy desk');
      await page.screenshot({ path: `/tmp/ps-dashboard-presets-${width}.png`, animations: 'disabled' });
      await page.locator('#psSavedWorkspaces [data-dashboard-workspace]').filter({ hasText: 'My energy desk' }).click();
    } else {
      await page.locator('[data-mobile-tab="more"]').click();
      await expect(page.locator('#psMobileSavedWorkspaces')).toContainText('My energy desk');
      await page.screenshot({ path: `/tmp/ps-dashboard-presets-${width}.png`, animations: 'disabled' });
      await page.locator('#psMobileSavedWorkspaces [data-dashboard-workspace]').filter({ hasText: 'My energy desk' }).click();
    }
    await expect(label).toContainText('Finance');
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await page.screenshot({ path: `/tmp/ps-workspace-${width}.png`, animations: 'disabled' });
    if (width === 1440) {
      await page.locator('.dashboard-tab.active .dashboard-tab-close').click();
      await expect(label).toContainText('Energy');
      await expect(page.locator('#regionSelect')).toHaveValue('eu');
    }
    expect(errors).toEqual([]);
  });
}
