import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam shipping layer');

for (const width of [1440, 390]) {
  test(`commercial shipping loads on the dashboard at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'commercial-profile', clearStorage: true, localStorage: {
        'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false',
        'worldmonitor-panels': JSON.stringify({ politics: { name: 'World News', enabled: true, priority: 0 } }),
      } },
    });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    let state: 'vessels' | 'empty' | 'unavailable' = 'vessels';
    let requests = 0;
    let areaBounds: string | null = null;
    await page.route(/\/api\/commercial-shipping(?:\?|$)/, route => {
      requests++;
      areaBounds = new URL(route.request().url()).searchParams.get('bbox');
      if (areaBounds) return route.fulfill({ json: { available: true, limited: false, vessels: [
        { mmsi: '211000004', name: 'Synthetic Hormuz Tanker', shipType: 80, lat: 26.5, lon: 56.5, timestamp: Date.now() },
        { mmsi: '211000005', name: 'Outside search', shipType: 70, lat: -10, lon: -30, timestamp: Date.now() },
      ] } });
      return route.fulfill({ json: { available: state !== 'unavailable', limited: false, vessels: state === 'vessels' ? [
        { mmsi: '211000001', name: 'Synthetic Cargo', shipType: 70, lat: 28, lon: 15, speed: 12.5, course: 90, heading: 90, timestamp: Date.now() },
        { mmsi: '211000002', name: 'Synthetic Tanker', shipType: 80, lat: 10, lon: 35, speed: 9, course: 180, heading: 180, timestamp: Date.now() },
        { mmsi: '211000003', name: 'Expired vessel', shipType: 70, lat: 0, lon: 0, timestamp: Date.now() - 11 * 60_000 },
      ] : [] } });
    });
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
    await expect(page.locator('.commercial-shipping-marker')).toHaveCount(2);
    const shipping = page.locator('.commercial-shipping-status');
    await expect(shipping).toContainText('Chokepoint focus · 2 recent positions');
    await expect(page.locator('[data-mmsi="211000001"] title')).toContainText('Synthetic Cargo · Cargo · MMSI 211000001');
    await expect(page.locator('[data-mmsi="211000003"]')).toHaveCount(0);
    await shipping.locator('summary').click();
    const search = shipping.getByLabel('Search shipping area');
    await search.fill('unknown test location');
    await search.press('Enter');
    await expect(shipping).toContainText('Area not found');
    await search.fill('Strait of Hormuz');
    await shipping.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(shipping).toContainText('Strait of Hormuz · 1 recent position');
    expect(areaBounds).toBe('24.5,54.5,28.5,58.5');
    await expect(page.locator('[data-mmsi="211000004"]')).toHaveCount(1);
    await expect(page.locator('.commercial-shipping-marker')).toHaveCount(1);
    await page.locator('#timeSlider .time-btn.active').click({ trial: true });
    await shipping.getByRole('button', { name: 'Reset area' }).scrollIntoViewIfNeeded();
    await page.locator('#mapSection').screenshot({ path: info.outputPath(`commercial-shipping-${width}.png`) });
    if (width === 1440) {
      await search.fill('Bandar Abbas');
      await search.press('Enter');
      await expect(shipping.locator('summary')).toContainText('Bandar Abbas · 1 recent position');
      await search.fill('Iran');
      await search.press('Enter');
      await expect(shipping.locator('summary')).toContainText(/Iran.*1 recent position/i);
      expect(areaBounds).not.toBe('24.5,54.5,28.5,58.5');
    }
    await shipping.getByRole('button', { name: 'Reset area' }).click();
    await expect(shipping).toContainText('Chokepoint focus · 2 recent positions');
    await expect(page.locator('.commercial-shipping-marker')).toHaveCount(2);
    expect(areaBounds).toBeNull();
    if (width === 1440) {
      const toggle = page.locator('.layer-toggle[data-layer="commercialShipping"]');
      await toggle.click();
      await expect(page.locator('.commercial-shipping-marker')).toHaveCount(0);
      await expect(page.locator('.commercial-shipping-status')).toBeHidden();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-layers') || '{}').commercialShipping)).toBe(false);
      await expect.poll(() => {
        const layers = new URL(page.url()).searchParams.get('layers');
        return layers !== null && !layers.split(',').includes('commercialShipping');
      }).toBe(true);
      const beforeReload = requests;
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
      await expect(toggle).not.toHaveClass(/active/);
      expect(requests).toBe(beforeReload);
      state = 'empty';
      await toggle.click();
      await expect(page.locator('.commercial-shipping-status')).toContainText('No recent classified vessels');
      await toggle.click();
      state = 'unavailable';
      await toggle.click();
      await expect(page.locator('.commercial-shipping-status')).toContainText('AIS feed unavailable');
      await expect(page.locator('.commercial-shipping-marker')).toHaveCount(0);
    }
  });
}

for (const renderer of ['svg', 'globe', 'deck'] as const) {
  test(`commercial shipping paints and hides native ${renderer} markers`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto('/tests/map-harness.html');
    await page.waitForFunction(() => (window as any).__mapHarness?.ready);
    await page.evaluate(async renderer => {
      (window as any).__mapHarness.destroy();
      document.getElementById('app')?.replaceChildren();
      const path = renderer === 'svg' ? '/src/components/Map.ts' : renderer === 'globe' ? '/src/components/GlobeMap.ts' : '/src/components/DeckGLMap.ts';
      const module = await import(/* @vite-ignore */ path);
      const container = document.createElement('div');
      document.body.classList.remove('e2e-deterministic');
      container.id = 'commercial-map';
      container.style.cssText = 'position:fixed;inset:10px;background:#10212a';
      document.body.append(container);
      const Constructor = module.MapComponent ?? module.GlobeMap ?? module.DeckGLMap;
      const map = new Constructor(container, { view: 'global', layers: { commercialShipping: true }, timeRange: 'all', zoom: 2, pan: { x: 0, y: 0 } }, { chrome: true });
      (window as any).commercialMap = map;
      if (map.whenReady) await map.whenReady();
      map.setCommercialVessels([{ mmsi: '211000001', name: 'Synthetic Commercial Cargo', shipType: 70, lat: 15, lon: 0, speed: 12, course: 90, heading: 90, timestamp: Date.now() }]);
      if (renderer === 'globe') {
        await map.whenViewportSettled();
        map.globe.controls().autoRotate = false;
        map.setCenter(15, 0, 2);
        await map.whenViewportSettled();
      }
      if (renderer === 'deck') {
        map.maplibreMap.setStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#10212a' } }] });
        const layers = map.buildLayers();
        const layer = layers.find((layer: any) => layer.id === 'commercial-shipping-layer');
        if (!layer || layer.constructor.layerName !== 'IconLayer' || layer.props.data.length !== 1) throw new Error('Commercial IconLayer missing');
        if (!map.getTooltip({ layer, object: layer.props.data[0] }).html.includes('Synthetic Commercial Cargo')) throw new Error('Vessel tooltip missing');
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Commercial ship was not drawn/pickable')), 15_000);
          const check = () => {
            // Read the GPU picking buffer across the viewport. The emoji artwork
            // has transparent pixels, so its geographic anchor is not a hit target.
            const picked = map.deckOverlay?._deck?.pickObjects({ x: 0, y: 0, width: container.clientWidth, height: container.clientHeight });
            if (picked?.some((p: any) => p.object?.mmsi === '211000001')) { clearTimeout(timeout); resolve(); }
            else setTimeout(check, 100);
          };
          check();
        });
      }
    }, renderer);
    if (renderer === 'svg') await expect(page.locator('.commercial-shipping-marker')).toHaveCount(1);
    if (renderer === 'globe') await expect(page.locator('[title*="Synthetic Commercial Cargo"] .planetslam-layer-glyph')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`commercial-${renderer}.png`) });
    await page.evaluate(() => (window as any).commercialMap.setLayers({ commercialShipping: false }));
    if (renderer === 'svg') await expect(page.locator('.commercial-shipping-marker')).toHaveCount(0);
    if (renderer === 'globe') await expect(page.locator('[title*="Synthetic Commercial Cargo"]')).toHaveCount(0);
    if (renderer === 'deck') expect(await page.evaluate(() => (window as any).commercialMap.buildLayers().some((l: any) => l.id === 'commercial-shipping-layer'))).toBe(false);
    await page.evaluate(() => (window as any).commercialMap.destroy());
  });
}
