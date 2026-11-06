import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installSpaceFixtures } from './space-dashboard-fixtures';

const planetslam = process.env.VITE_BRAND === 'planetslam';
const expectedCredit = planetslam ? '© MythoByte' : '© Elie Habib · Someone™';

test('2D and 3D map controls display the configured author credit', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/tests/map-harness.html');
  await page.waitForFunction(() => (window as Window & { __mapHarness?: { ready: boolean } }).__mapHarness?.ready === true);
  // The harness's map-image mode deliberately hides all chrome with a fixture
  // stylesheet. Remove only that test-only mode so the normal controls render.
  await page.evaluate(() => document.body.classList.remove('e2e-deterministic'));
  const deckCredit = page.locator('#app .map-author-badge');
  await expect(deckCredit).toHaveText(expectedCredit);
  await expect(deckCredit).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('map-credit-2d.png') });

  // Use the actual globe renderer with its normal layer controls. The dashboard
  // otherwise selects the SVG fallback on software GL, which has no such badge.
  await page.evaluate(async () => {
    const module = '/src/components/GlobeMap.ts';
    const { GlobeMap } = await import(/* @vite-ignore */ module);
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;inset:20px;z-index:999999;background:#101923';
    const container = document.createElement('div');
    container.id = 'map-credit-globe';
    stage.appendChild(container);
    document.body.appendChild(stage);
    const map = new GlobeMap(container, {
      view: 'global', layers: {}, timeRange: 'all', zoom: 2, pan: { x: 0, y: 0 },
    }, { chrome: true });
    (window as Window & { __mapCreditCleanup?: () => void }).__mapCreditCleanup = () => {
      map.destroy(); stage.remove();
    };
    await map.whenReady();
  });
  try {
    const globe = page.locator('#map-credit-globe');
    await expect(globe.locator('canvas')).toBeVisible();
    await expect(globe.locator('.map-author-badge')).toHaveText(expectedCredit);
    await expect(globe.locator('.map-author-badge')).toBeVisible();
    await expect(globe.locator('.map-author-badge')).toBeInViewport();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath('map-credit-3d.png') });
  } finally {
    await page.evaluate(() => (window as Window & { __mapCreditCleanup?: () => void }).__mapCreditCleanup?.());
  }
});

test('PlanetSlam dashboard identifies MythoByte as its author', async ({ page }) => {
  test.skip(!planetslam, 'PlanetSlam metadata is scoped to branded builds');
  await installSpaceFixtures(page);
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'map-credit-acceptance', clearStorage: true } });
  await page.goto('/dashboard?variant=space');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('meta[name="author"]')).toHaveAttribute('content', 'MythoByte');
  const author = await page.locator('script[type="application/ld+json"]').evaluateAll(scripts => {
    const app = scripts.map(script => JSON.parse(script.textContent || '{}'))
      .find(value => value['@type'] === 'SoftwareApplication');
    return app?.author;
  });
  expect(author).toEqual({ '@type': 'Organization', name: 'MythoByte', url: 'https://github.com/MythoByte' });
});
