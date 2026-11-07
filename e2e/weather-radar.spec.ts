import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { installEarthFixtures } from './earth-dashboard-fixtures';

// A small, explicitly synthetic raster. Tests exercise real MapLibre decoding/rendering.
function png(red: number, green: number, blue: number): Buffer {
  const crc = (bytes: Buffer): number => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name: string, data: Buffer): Buffer => { const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(16); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(16 * (1 + 16 * 4));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const at = y * 65 + 1 + x * 4; rows[at] = red; rows[at + 1] = green; rows[at + 2] = blue; rows[at + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const style = { version: 8, sources: { baseline: { type: 'raster', tiles: ['https://basemap.test/{z}/{x}/{y}.png'], tileSize: 256 } },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#12202b' } }, { id: 'baseline', type: 'raster', source: 'baseline' }] };
async function setup(page: Page) {
  await page.addInitScript(() => { if (!sessionStorage.getItem('radar-acceptance')) { localStorage.clear(); sessionStorage.setItem('radar-acceptance', '1'); } localStorage.setItem('wm-map-provider', 'carto'); });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
}
function manifest() { const time = Math.floor(Date.now() / 600_000) * 600; return { generated: Math.floor(Date.now() / 1000), host: 'https://tilecache.rainviewer.com', radar: { past: [{ time, path: '/v2/radar/synthetic_acceptance' }] } }; }

test('real MapLibre paints first radar before delayed basemap completion; warm reload reuses the cached frame and caps tile zoom', async ({ page }, info) => {
  await setup(page);
  let releaseStyle!: () => void, releaseBase!: () => void;
  const styleGate = new Promise<void>(resolve => { releaseStyle = resolve; }), baseGate = new Promise<void>(resolve => { releaseBase = resolve; });
  let manifestRequests = 0, baselineDelivered = 0, firstRadarAt = 0, baselineHeld = false, baselinePending = 0;
  const tileZooms: number[] = [], startedAt = Date.now();
  await page.route('https://api.rainviewer.com/**', route => { manifestRequests++; return route.fulfill({ json: manifest() }); });
  await page.route('https://basemaps.cartocdn.com/**', async route => { await styleGate; await route.fulfill({ json: style }); });
  await page.route('https://basemap.test/**', async route => { if (!baselineHeld) { baselineHeld = true; baselinePending++; await baseGate; baselinePending--; } baselineDelivered++; await route.fulfill({ contentType: 'image/png', body: png(18, 32, 43) }); });
  await page.route('https://tilecache.rainviewer.com/**', async route => {
    if (!firstRadarAt) firstRadarAt = Date.now();
    tileZooms.push(Number(new URL(route.request().url()).pathname.split('/')[5]));
    await route.fulfill({ contentType: 'image/png', body: png(40, 160, 255) });
  });
  await page.goto('/tests/map-harness.html');
  const status = page.getByTestId('weather-radar-status');
  await expect(status).toContainText('frame'); // Metadata arrived while the style is still unavailable.
  expect(manifestRequests).toBe(1);
  const styleReleasedAt = Date.now(); releaseStyle();
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(status).toBeVisible();
  await expect(status.getByRole('link', { name: 'RainViewer' })).toBeVisible();
  expect(await status.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); })).toBe(true);
  expect(firstRadarAt).toBeGreaterThan(0); expect(baselinePending).toBe(1); expect(baselineDelivered).toBeGreaterThan(0);
  await expect(page.locator('#deckgl-basemap canvas')).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: info.outputPath('radar-before-basemap.png') });
  releaseBase();
  await page.waitForFunction(() => (window as unknown as { __mapHarness?: { ready: boolean } }).__mapHarness?.ready === true);
  await page.evaluate(() => { (window as unknown as { __mapHarness: { setLayersForSnapshot(layers: string[]): void; setCamera(camera: { lat: number; lon: number; zoom: number }): void } }).__mapHarness.setLayersForSnapshot(['weather']); (window as unknown as { __mapHarness: { setCamera(camera: { lat: number; lon: number; zoom: number }): void } }).__mapHarness.setCamera({ lat: 38, lon: -95, zoom: 10 }); });
  await expect.poll(() => Math.max(...tileZooms)).toBe(7);
  expect(tileZooms.every(zoom => Number.isFinite(zoom) && zoom <= 7)).toBe(true);
  const warmStartedAt = Date.now(), priorManifestRequests = manifestRequests;
  await page.reload(); await expect(status).toHaveAttribute('data-state', 'ready');
  expect(manifestRequests).toBe(priorManifestRequests);
  const timings = JSON.stringify({ data: 'synthetic manifest and images; real MapLibre/software WebGL', firstRadarRequestSinceNavigationMs: firstRadarAt - startedAt, firstRadarRequestSinceStyleMs: firstRadarAt - styleReleasedAt, warmReadyMs: Date.now() - warmStartedAt, manifestRequests, highestRequestedTileZoom: Math.max(...tileZooms) });
  await writeFile(info.outputPath('radar-timings.json'), timings);
  await info.attach('radar-timings', { path: info.outputPath('radar-timings.json'), contentType: 'application/json' });
});

test('radar outage is visible and the user can retry immediately without waiting five minutes', async ({ page }, info) => {
  await setup(page); let fail = true, manifestRequests = 0;
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({ json: style }));
  await page.route('https://basemap.test/**', route => route.fulfill({ contentType: 'image/png', body: png(18, 32, 43) }));
  await page.route('https://api.rainviewer.com/**', route => { manifestRequests++; return route.fulfill(fail ? { status: 503, json: {} } : { json: manifest() }); });
  await page.route('https://tilecache.rainviewer.com/**', route => route.fulfill({ contentType: 'image/png', body: png(40, 160, 255) }));
  await page.goto('/tests/map-harness.html'); const status = page.getByTestId('weather-radar-status');
  await expect(status).toHaveAttribute('data-state', 'unavailable');
  await page.screenshot({ path: info.outputPath('radar-outage.png') });
  fail = false; await status.getByRole('button', { name: 'Retry radar', exact: true }).click();
  await expect(status).toHaveAttribute('data-state', 'ready'); expect(manifestRequests).toBe(2);
  await page.screenshot({ path: info.outputPath('radar-recovered.png') });
});


test('Earth 3D button preloads only the selected globe texture while the renderer module is pending', async ({ page }, info) => {
  test.skip(process.env.VITE_BRAND !== 'planetslam', 'Earth is a PlanetSlam edition');
  await installEarthFixtures(page);
  await seedAnonymousDashboard(page, 'full', { initializeOnce: { sessionKey: 'earth-globe-acceptance', clearStorage: true,
    localStorage: { 'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false', 'wm-globe-texture': 'blue-marble' } } });
  let releaseModule!: () => void, modulePending = false, textureWhileModulePending = false;
  const moduleGate = new Promise<void>(resolve => { releaseModule = resolve; });
  const textures: string[] = [];
  await page.route('**/src/components/GlobeMap.ts*', async route => { modulePending = true; await moduleGate; await route.continue(); });
  page.on('request', request => { if (request.url().includes('/textures/earth-')) { textures.push(request.url()); textureWhileModulePending ||= modulePending; } });
  await page.goto('/dashboard?variant=earth');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  const button = page.locator('#mapDimensionToggle .map-dim-btn[data-mode="globe"]');
  await expect(button).toBeVisible();
  await page.screenshot({ path: info.outputPath('earth-before-globe.png') });
  const clickedAt = Date.now(); await button.click();
  await expect.poll(() => textures.length).toBe(1);
  expect(textures[0]).toContain('/textures/earth-blue-marble.jpg');
  expect(textureWhileModulePending).toBe(true);
  const textureStartedMs = Date.now() - clickedAt;
  releaseModule();
  await expect(page.locator('#mapContainer.globe-mode:not([aria-busy])')).toBeVisible();
  await expect(page.locator('#mapContainer canvas')).toBeVisible();
  await expect(button).toHaveClass(/active/);
  await page.screenshot({ path: info.outputPath('earth-globe.png') });
  expect(textures).toHaveLength(1);
  const timing = JSON.stringify({ data: 'synthetic Earth feeds; local real texture; software WebGL; renderer module held until texture request', textureStartedMs, textureWhileModulePending, textureRequests: textures.length });
  await writeFile(info.outputPath('globe-timings.json'), timing);
  await info.attach('globe-timings', { path: info.outputPath('globe-timings.json'), contentType: 'application/json' });
});
