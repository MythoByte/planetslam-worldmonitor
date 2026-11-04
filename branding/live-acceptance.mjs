import assert from 'node:assert/strict';
import { seedProfile, waitForBoot, waitForMap } from '../.agents/skills/verify-worldmonitor/steps/_profile.mjs';

export default async function ({ page, base, shot, log }) {
  await seedProfile(page, { localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false' } });
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  assert.equal(await page.locator('html').getAttribute('data-brand'), 'planetslam');
  const response = await page.request.get(`${base}/api/seismology/v1/list-earthquakes?page_size=500`);
  assert.equal(response.status(), 200);
  const data = await response.json();
  assert.ok(Array.isArray(data.earthquakes) && data.earthquakes.length > 0);
  assert.ok(data.earthquakes.every(q => Number.isFinite(q.magnitude)));
  log('live-earthquake-rpc', { status: response.status(), records: data.earthquakes.length, sources: [...new Set(data.earthquakes.map(q => q.source))], mocked: false });
  const renderer = await waitForMap(page);
  assert.equal(renderer, 'globe');
  const canvas = page.locator('#mapContainer canvas').first();
  assert.ok(await canvas.isVisible());
  await shot('live-desktop-globe');
  await page.locator('#mapDimensionToggle [data-mode="flat"]').click();
  await page.waitForFunction(() => !document.querySelector('#mapContainer')?.classList.contains('globe-mode'));
  await page.waitForFunction(() => localStorage.getItem('worldmonitor-map-mode') === '"flat"');
  await page.locator('#mapDimensionToggle [data-mode="globe"]').click();
  await page.waitForSelector('#mapContainer.globe-mode');
  await page.waitForFunction(() => localStorage.getItem('worldmonitor-map-mode') === '"globe"');
  log('map-toggle', { globeToFlatAndBack: true, persisted: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('live-mobile');
}
