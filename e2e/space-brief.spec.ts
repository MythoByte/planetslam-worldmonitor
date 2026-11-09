import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installSpaceFixtures, spaceFixture } from './space-dashboard-fixtures';
import type { SpaceBriefData } from '../src/types/space';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam Space feature');
async function boot(page: Page) {
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'brief-acceptance', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } } });
  await page.goto('/dashboard?variant=space&layers=satellites,spaceports,aurora,webcams');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
}

for (const width of [1440, 390]) {
  test(`source-linked Space daily brief and cache-only fallback at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await installSpaceFixtures(page);
    const briefRequests: { url: string; method: string; body: string | null }[] = [];
    const llmRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/space?dataset=brief')) briefRequests.push({ url: request.url(), method: request.method(), body: request.postData() });
      if (/chat\/completions|summarize-article|generate-summary|api\.groq\.com|openrouter\.ai/.test(request.url())) llmRequests.push(request.url());
    });
    await boot(page);
    const brief = page.locator('[data-panel="space-brief"]');
    await expect(async () => { await brief.scrollIntoViewIfNeeded(); await expect(brief.locator('[data-brief-status]')).toHaveAttribute('data-brief-status', 'fresh'); }).toPass({ timeout: 20000 });
    await expect(brief).toContainText('Synthetic Space daily brief');
    await expect(brief).toContainText('AI-generated synthesis');
    await expect(brief).toContainText('Synthetic NEO coverage gap');
    await expect(brief.locator('[data-brief-citation="source-news"]')).toHaveAttribute('href', 'https://example.com/news/science');
    await brief.locator('[data-brief-citation="source-news"]').focus();
    await expect(brief.locator('[data-brief-citation="source-news"]')).toBeFocused();
    await expect(brief.locator('[data-brief-citation="source-news"]')).toHaveAccessibleName('Source 1: Synthetic original science story');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath(`brief-ai-${width}.png`) });
    await page.context().route('https://example.com/news/science**', route => route.fulfill({ contentType: 'text/plain', body: 'Synthetic cited source' }));
    const [sourcePage] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
    await expect(sourcePage).toHaveURL(/^https:\/\/example\.com\/news\/science(?:\?|$)/);
    await sourcePage.close();
    const fallback = spaceFixture('brief');
    fallback.data = { ...fallback.data as SpaceBriefData, mode: 'source-summary', model: null };
    await installSpaceFixtures(page, { brief: fallback });
    await brief.getByRole('button', { name: 'Refresh brief', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(brief).toContainText('Source summary · not AI-generated');
    await expect(brief).not.toContainText('synthetic-acceptance-model');
    await expect(brief).toContainText('Refresh reads the saved brief');
    expect(briefRequests).toHaveLength(2);
    expect(briefRequests.every(request => request.method === 'GET' && request.body === null
      && [...new URL(request.url).searchParams.keys()].join(',') === 'dataset')).toBe(true);
    expect(llmRequests).toEqual([]);
    await brief.locator('[data-brief-detail="sources"] summary').focus();
    await page.keyboard.press('Enter');
    await expect(brief.locator('[data-brief-detail="sources"]')).toHaveAttribute('open', '');
    await expect(brief.locator('[data-brief-source="source-weather"]')).toContainText('stale');
    await expect(brief.locator('[data-brief-source="source-weather"]')).toContainText('Observed / published');
    await brief.locator('[data-brief-detail="sources"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath(`brief-sources-${width}.png`) });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await testInfo.attach('Space daily brief with synthetic cached data', { path: testInfo.outputPath(`brief-ai-${width}.png`), contentType: 'image/png' });
  });
}

test('Space brief shows stale provenance, hides outages and recovers on cache refresh', async ({ page }, testInfo) => {
  await installSpaceFixtures(page, { brief: { status: 'stale', message: 'Previous UTC edition; refresh delayed.' } });
  await boot(page);
  const brief = page.locator('[data-panel="space-brief"]');
  await expect(async () => { await brief.scrollIntoViewIfNeeded(); await expect(brief).toContainText('Stale · last available brief'); }).toPass({ timeout: 20000 });
  await expect(brief).toContainText('Previous UTC edition');
  await installSpaceFixtures(page, { brief: { status: 'unavailable', data: null, message: 'No usable source snapshots.' } });
  await brief.getByRole('button', { name: 'Refresh brief', exact: true }).click();
  await expect(brief.locator('[data-brief-status]')).toHaveAttribute('data-brief-status', 'unavailable');
  await expect(brief).toContainText('No usable source snapshots');
  await expect(brief).toContainText('does not mean that no launches, events, or hazards exist');
  await expect(brief.locator('[data-brief-citation]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('brief-unavailable.png') });
  await installSpaceFixtures(page);
  await brief.getByRole('button', { name: 'Refresh brief', exact: true }).click();
  await expect(brief.locator('[data-brief-status]')).toHaveAttribute('data-brief-status', 'fresh');
  await expect(brief.locator('[data-brief-citation]')).toHaveCount(2);
});
