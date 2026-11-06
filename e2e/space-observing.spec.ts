import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installSpaceFixtures } from './space-dashboard-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam Space feature');
async function boot(page: Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'observing-acceptance', clearStorage: true, localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await page.addInitScript(() => {
    const state = { geo: 0, permission: 0, deliveries: 0 };
    (window as unknown as { __spacePrivacy: typeof state }).__spacePrivacy = state;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(_success: unknown, error: (value: unknown) => void) { state.geo++; error({ code: 1, message: 'Synthetic permission denial' }); } } });
    let permission: NotificationPermission = 'default';
    class SyntheticNotification {
      static get permission() { return permission; }
      static async requestPermission() { state.permission++; permission = 'denied'; return permission; }
      constructor() { state.deliveries++; }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: SyntheticNotification });
  });
  await page.goto('/dashboard?variant=space');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
}
const preferences = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('planetslam-space-personalization-v1') || '{}'));
for (const width of [1440, 390]) {
  test(`local observer, passes, mission watchlists and denied reminders at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await installSpaceFixtures(page);
    const requests: string[] = [];
    page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url() + (request.postData() || '')); });
    await boot(page);
    const observing = page.locator('[data-panel="space-observing"]');
    const tracker = page.locator('[data-panel="space-satellites"]');
    const missions = page.locator('[data-panel="space-missions"]');
    await expect(async () => { await observing.scrollIntoViewIfNeeded(); await expect(observing.locator('[data-observing-status]')).toHaveAttribute('data-observing-status', 'location-needed'); }).toPass({ timeout: 20000 });
    await expect(observing).toContainText('illuminated');
    expect(await page.evaluate(() => (window as unknown as { __spacePrivacy: unknown }).__spacePrivacy)).toEqual({ geo: 0, permission: 0, deliveries: 0 });
    await observing.locator('[data-observer-lat]').fill('40.7128');
    await observing.locator('[data-observer-lon]').fill('-74.006');
    await observing.locator('[data-observer-save]').click();
    await expect(observing.locator('[data-observing-status]')).toHaveAttribute('data-observing-status', 'ready', { timeout: 30000 });
    expect((await preferences(page)).observer).toEqual({ latitude: 40.7128, longitude: -74.006, altitudeM: 0 });
    await expect(observing.locator('[data-observing-pass="25544"]').first()).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath(`observing-${width}.png`) });
    await observing.locator('[data-observing-horizon]').selectOption('48');
    await expect.poll(async () => (await preferences(page)).horizonHours).toBe(48);
    await expect(async () => { await tracker.scrollIntoViewIfNeeded(); await expect(tracker.locator('[data-orbit-watch="25544"]')).toBeVisible(); }).toPass({ timeout: 15000 });
    await tracker.locator('[data-orbit-watch="25544"]').click();
    expect((await preferences(page)).satelliteWatchlist).toContain('25544');
    await expect(async () => { await missions.scrollIntoViewIfNeeded(); await expect(missions.locator('[data-mission-watch="fixture-docking"]')).toBeVisible(); }).toPass({ timeout: 15000 });
    await missions.locator('[data-mission-kind]').selectOption('docking');
    await expect(missions).toContainText('Synthetic docking acceptance event');
    await expect(missions).not.toContainText('Synthetic briefing acceptance event');
    await missions.locator('[data-mission-watch="fixture-docking"]').click();
    expect((await preferences(page)).missionWatchlist).toContain('fixture-docking');
    await page.screenshot({ path: testInfo.outputPath(`missions-${width}.png`) });
    await observing.scrollIntoViewIfNeeded();
    await observing.locator('[data-notifications-enable]').click();
    await expect(observing).toContainText('Browser permission denied');
    const privacy = await page.evaluate(() => (window as unknown as { __spacePrivacy: { geo: number; permission: number; deliveries: number } }).__spacePrivacy);
    expect(privacy).toEqual({ geo: 0, permission: 1, deliveries: 0 });
    expect(requests.some(request => request.includes('40.7128') || request.includes('-74.006'))).toBe(false);
    await page.reload();
    await expect(async () => { await observing.scrollIntoViewIfNeeded(); await expect(observing.locator('[data-observer-lat]')).toHaveValue('40.7128'); }).toPass({ timeout: 20000 });
    expect((await preferences(page)).missionWatchlist).toContain('fixture-docking');
    await observing.locator('[data-observer-clear]').click();
    expect((await preferences(page)).observer).toBeNull();
    await expect(observing.locator('[data-observing-pass]')).toHaveCount(0);
    await observing.locator('[data-observer-geolocate]').click();
    await expect(observing).toContainText('Location access was denied or unavailable');
    expect(await page.evaluate(() => (window as unknown as { __spacePrivacy: { geo: number } }).__spacePrivacy.geo)).toBe(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await testInfo.attach('Observing with synthetic orbital data', { path: testInfo.outputPath(`observing-${width}.png`), contentType: 'image/png' });
  });
}
