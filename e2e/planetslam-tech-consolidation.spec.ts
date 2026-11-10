import { test, expect } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installCyberFixtures } from './cyber-dashboard-fixtures';
test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam dashboard consolidation');

for (const width of [1440, 390]) {
  test(`Tech consolidates Cyber, defaults to 24 hours and preserves records at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'tech-consolidation', clearStorage: true, localStorage: {
      'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false',
      'worldmonitor-panel-layout-variant': 'tech',
      'worldmonitor-panels': JSON.stringify({ security: { name: 'Cybersecurity', enabled: true, priority: 1 }, 'cyber-kev': { name: 'Exploited Vulnerabilities', enabled: false, priority: 1 } }),
      'planetslam-cyber-watchlist-v1': '["docker"]',
    } } });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    await installCyberFixtures(page);
    await page.route('**/api/news/v1/list-feed-digest?*', route => route.fulfill({ json: {
      categories: { security: { items: [{ source: 'Krebs Security', title: 'Synthetic existing Tech report', link: 'https://example.com/docker', publishedAt: Date.now(), isAlert: false }] } },
      feedStatuses: {}, generatedAt: new Date().toISOString(),
    } }));
    // A retired URL opens Tech, retaining all other explicit URL state.
    await page.goto('/dashboard?variant=cyber');
    await expect(page).not.toHaveURL(/variant=/);
    await expect(page.locator(width > 768 ? '.ps-dashboard-picker > summary' : '.ps-mobile-dashboard')).toContainText('Tech');
    await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    await expect(page.locator('.time-btn.active').first()).toHaveAttribute('data-range', '24h');
    await expect(page.locator('[data-variant="cyber"]')).toHaveCount(0);
    await expect(page.locator('[data-panel="cyber-news"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`tech-navigation-${width}.png`) });
    await page.locator('#mapContainer').screenshot({ path: info.outputPath(`tech-map-24h-${width}.png`) });
    const security = page.locator('[data-panel="security"]');
    await expect(async () => { await security.scrollIntoViewIfNeeded(); await expect(security).toContainText('Synthetic ransomware incident report'); }).toPass({ timeout: 30000 });
    await expect(security).toContainText('Synthetic existing Tech report');
    await expect(security.getByText('Synthetic Docker patch announcement', { exact: true })).toHaveCount(0);
    await security.screenshot({ path: info.outputPath(`tech-security-merged-${width}.png`) });
    for (const id of ['environment', 'research', 'alerts', 'brief', 'attention', 'incidents', 'kev', 'watchlist', 'health']) {
      await expect(page.locator(`[data-panel="cyber-${id}"]`)).toHaveCount(1);
    }
    const kev = page.locator('[data-panel="cyber-kev"]');
    await expect(async () => { await kev.scrollIntoViewIfNeeded(); await expect(kev).toContainText('CVE-2026-99999'); }).toPass({ timeout: 30000 });
    await kev.screenshot({ path: info.outputPath(`tech-kev-${width}.png`) });
    expect(await page.evaluate(() => localStorage.getItem('planetslam-cyber-watchlist-v1'))).toBe('["docker"]');
    // The migration runs once; a subsequent intentional disable survives reload.
    await page.evaluate(() => { const settings=JSON.parse(localStorage.getItem('worldmonitor-panels')!);settings['cyber-kev'].enabled=false;localStorage.setItem('worldmonitor-panels',JSON.stringify(settings)); });
    await page.goto('/dashboard?variant=tech&timeRange=48h');
    await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
    await expect(page.locator('.time-btn.active').first()).toHaveAttribute('data-range', '48h');
    await expect(page.locator('[data-panel="cyber-kev"]')).toHaveCount(0);
  });
}
