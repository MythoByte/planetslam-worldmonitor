import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam marker presentation');

for (const { renderer, width } of [
  { renderer: 'svg', width: 1280 }, { renderer: 'svg', width: 390 },
  { renderer: 'globe', width: 1280 }, { renderer: 'deck', width: 1280 },
] as const) {
  test(`${renderer} at ${width}px uses layer icons and preserves marker data`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/tests/map-harness.html');
    await page.waitForFunction(() => (window as Window & { __mapHarness?: { ready: boolean } }).__mapHarness?.ready);
    const result = await page.evaluate(async renderer => {
      (window as Window & { __mapHarness?: { destroy: () => void } }).__mapHarness?.destroy();
      document.getElementById('app')?.replaceChildren();
      const iconsPath = '/src/components/map-layer-icons.ts';
      const { layerMarkerIcon, layerMarkerUrl } = await import(/* @vite-ignore */ iconsPath);
      const modulePath = renderer === 'svg' ? '/src/components/Map.ts'
        : renderer === 'globe' ? '/src/components/GlobeMap.ts' : '/src/components/DeckGLMap.ts';
      const module = await import(/* @vite-ignore */ modulePath);
      const stage = document.createElement('div');
      stage.style.cssText = 'position:fixed;inset:10px;z-index:999999;background:#101923';
      const container = document.createElement('div');
      container.id = 'icon-test-map';
      container.style.cssText = 'height:100%;width:100%';
      stage.appendChild(container); document.body.appendChild(stage);
      document.body.classList.remove('e2e-deterministic');
      const Constructor = module.MapComponent ?? module.GlobeMap ?? module.DeckGLMap;
      const map = new Constructor(container, {
        view: 'global', layers: { hotspots: true, nuclear: false, satellites: true },
        timeRange: 'all', zoom: 2, pan: { x: 0, y: 0 },
      }, { chrome: true });
      if (map.whenReady) await map.whenReady();
      if (renderer === 'deck') {
        // A controlled empty basemap proves native marker rendering without tile-provider dependencies.
        map.maplibreMap.setStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#10212a' } }] });
        await new Promise<void>(resolve => {
          const check = () => { if (map.deckOverlay?._deck?.isInitialized) resolve(); else requestAnimationFrame(check); };
          check();
        });
      }
      window.addEventListener('planetslam:earth-select', () => { document.body.dataset.iconSelection = 'earth'; });
      map.setEarthMap({ markers: [
        { id: 'test-camera', kind: 'camera', title: 'Synthetic camera', hazard: 'camera', mode: '', severity: '', latitude: 30, longitude: 0 },
        { id: 'test-fire', kind: 'event', title: 'Synthetic wildfire', hazard: 'wildfire', mode: 'warning', severity: 'severe', latitude: 0, longitude: 0 },
      ] });
      map.setCyberMap({ markers: [{ id: 'test-cyber', kind: 'incident', label: 'Synthetic report', latitude: 15, longitude: 20 }] });
      map.setSpaceOverlay({ aurora: [], launches: [{ id: 'test-launch', name: 'Synthetic launch', pad: 'Test pad', net: '2026-11-09T00:00:00Z', latitude: -15, longitude: 0 }] });
      if (renderer === 'deck') {
        const layers = map.buildLayers();
        const expected = ['hotspots-layer', 'earth-events-and-cameras', 'cyber-native-incident', 'space-upcoming-launches'];
        const markers = expected.map(id => layers.find((layer: { id: string }) => layer.id === id));
        if (markers.some(layer => !layer || layer.constructor.layerName !== 'IconLayer')) throw new Error('Expected native IconLayers');
        const earth = layers.find((layer: { id: string }) => layer.id === 'earth-events-and-cameras');
        if (earth.props.data[0].id !== 'test-camera' || !earth.props.pickable || typeof earth.props.onClick !== 'function') throw new Error('Marker interaction lost');
      }
      if (renderer === 'deck') {
        const deck = map.deckOverlay._deck;
        const position = map.maplibreMap.project([0, 0]);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Earth icon was not drawn/pickable after artwork load')), 15_000);
          const check = () => {
            const picked = deck.pickObject({ x: position.x, y: position.y, radius: 8 });
            if (picked?.object?.id === 'test-fire') { clearTimeout(timeout); resolve(); }
            else { map.maplibreMap.triggerRepaint(); requestAnimationFrame(check); }
          };
          check();
        });
      }
      if (renderer === 'globe') {
        await map.whenViewportSettled();
        map.globe.controls().autoRotate = false;
        map.setCenter(15, 0, 2);
        await map.whenViewportSettled();
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { hotspot: layerMarkerUrl(layerMarkerIcon('hotspots')), camera: layerMarkerUrl(layerMarkerIcon('webcams')), fire: layerMarkerUrl(layerMarkerIcon('fires')), cyber: layerMarkerUrl(layerMarkerIcon('cyberThreats')) };
    }, renderer);
    const map = page.locator('#icon-test-map');
    if (renderer === 'svg') {
      await expect(map.locator('.hotspot .planetslam-layer-glyph').first()).toHaveAttribute('src', result.hotspot);
      await expect(map.locator('[data-earth-marker="test-camera"]')).toHaveAttribute('href', result.camera);
      await expect(map.locator('[data-earth-marker="test-fire"]')).toHaveAttribute('href', result.fire);
      await expect(map.locator('[data-cyber-marker="test-cyber"]')).toHaveAttribute('href', result.cyber);
      await expect(map.locator('circle[data-earth-marker]')).toHaveCount(0);
    } else if (renderer === 'globe') {
      await expect(map.locator('.planetslam-layer-glyph').first()).toBeVisible();
    } else {
      await expect(map.locator('canvas').first()).toBeVisible();
    }
    await expect.poll(() => map.locator('img.planetslam-layer-glyph').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    if (renderer !== 'deck') {
      const fire = renderer === 'svg' ? map.locator('[data-earth-marker="test-fire"]') : map.locator('.planetslam-layer-marker[title^="Synthetic wildfire"]');
      await fire.click({ timeout: 15_000 });
      await expect(page.locator('body')).toHaveAttribute('data-icon-selection', 'earth');
    }
    await page.screenshot({ path: info.outputPath(`layer-icons-${renderer}-${width}.png`) });
  });
}
