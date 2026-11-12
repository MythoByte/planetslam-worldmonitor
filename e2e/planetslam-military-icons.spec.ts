import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam platform presentation');

for (const { renderer, width } of [
  { renderer: 'svg', width: 1440 }, { renderer: 'svg', width: 390 },
  { renderer: 'globe', width: 1440 }, { renderer: 'deck', width: 1440 },
] as const) {
  test(`${renderer} at ${width}px distinguishes aircraft and vessels`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/tests/map-harness.html');
    await page.waitForFunction(() => (window as any).__mapHarness?.ready);
    const result = await page.evaluate(async renderer => {
      (window as any).__mapHarness.destroy();
      document.getElementById('app')?.replaceChildren();
      document.body.classList.remove('e2e-deterministic');
      const iconPath = '/src/components/map-layer-icons.ts';
      const { markerHeading, platformMarkerIcon } = await import(/* @vite-ignore */ iconPath);
      if ([511, -1, NaN, undefined].some(value => markerHeading(value) !== 0)) throw Error('Invalid heading accepted');
      if (platformMarkerIcon('aircraft', 'unclassified') !== 'platform-aircraft-plane' || platformMarkerIcon('vessel', 'unclassified') !== 'platform-vessel-ship') throw Error('Unknown class must stay generic');
      const path = renderer === 'svg' ? '/src/components/Map.ts'
        : renderer === 'globe' ? '/src/components/GlobeMap.ts' : '/src/components/DeckGLMap.ts';
      const module = await import(/* @vite-ignore */ path);
      const Constructor = module.MapComponent ?? module.GlobeMap ?? module.DeckGLMap;
      const container = document.createElement('div');
      container.id = 'platform-test-map';
      container.style.cssText = 'position:fixed;inset:10px;background:#101923;z-index:1';
      document.body.appendChild(container);
      const map = new Constructor(container, { view: 'global', layers: { military: true, flights: true, cables: true, aircraftEmergencies: true }, timeRange: 'all', zoom: 2, pan: { x: 0, y: 0 } }, { chrome: true });
      (window as any).__platformMap = map;
      if (map.whenReady) await map.whenReady();
      if (renderer === 'deck') {
        map.maplibreMap.setStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#10212a' } }] });
        await new Promise<void>(resolve => { const check = () => map.deckOverlay?._deck?.isInitialized ? resolve() : requestAnimationFrame(check); check(); });
      }
      const aircraftTypes = ['fighter', 'bomber', 'transport', 'tanker', 'awacs', 'reconnaissance', 'helicopter', 'drone', 'patrol', 'special_ops', 'vip', 'unknown'];
      const vesselTypes = ['carrier', 'destroyer', 'frigate', 'submarine', 'amphibious', 'patrol', 'auxiliary', 'research', 'icebreaker', 'special', 'unknown'];
      const flights = aircraftTypes.map((aircraftType, i) => ({
        id: `aircraft-${aircraftType}`, callsign: `TEST-${aircraftType}`, hexCode: `a${String(i).padStart(5, '0')}`, aircraftType,
        operator: 'other', operatorCountry: 'ZZ', lat: 45 - Math.floor(i / 6) * 25, lon: -40 + i % 6 * 15,
        heading: i === 0 ? 90 : 0, altitude: 20000, speed: 200, onGround: false, confidence: 'high', lastSeen: new Date(),
      }));
      const vessels = vesselTypes.map((vesselType, i) => ({
        id: `vessel-${vesselType}`, mmsi: `0000000${i}`, name: `TEST-${vesselType}`, vesselType,
        operator: 'other', operatorCountry: 'ZZ', lat: -5 - Math.floor(i / 6) * 25, lon: -40 + i % 6 * 15,
        heading: i === 0 ? 270 : 0, speed: 10, confidence: 'high', lastAisUpdate: new Date(), isDark: i === 1,
      }));
      const flightCluster = { id: 'flight-group', name: 'TEST aircraft group', lat: -45, lon: -20, flightCount: 4, flights: flights.slice(0, 4), activityType: 'exercise' };
      const vesselCluster = { id: 'vessel-group', name: 'TEST vessel group', lat: -45, lon: 20, vesselCount: 3, vessels: vessels.slice(0, 3), activityType: 'transit' };
      map.setMilitaryFlights(flights, [flightCluster]);
      map.setMilitaryVessels(vessels, [vesselCluster]);
      if (map.setAircraftEmergencies) map.setAircraftEmergencies([{ address: '000001', squawk: '7700', lat: 0, lon: 65 }]);
      map.setCableActivity([], [{ id: 'repair-test', name: 'TEST repair ship', lat: 0, lon: -65, status: 'working', operator: 'Synthetic', mmsi: '999999999' }]);
      if (renderer === 'deck') {
        const layers = map.buildLayers();
        for (const [id, expected] of [
          ['military-flights-layer', 'platform-aircraft-fighter'], ['military-vessels-layer', 'platform-vessel-carrier'],
          ['military-flight-clusters-layer', 'platform-aircraft-plane'], ['military-vessel-clusters-layer', 'platform-vessel-ship'],
          ['aircraft-emergencies', 'platform-aircraft-emergency'], ['repair-ships-layer', 'platform-vessel-repair'],
        ]) {
          const layer = layers.find((layer: any) => layer.id === id);
          if (!layer || layer.constructor.layerName !== 'IconLayer') throw Error(`Missing IconLayer ${id}`);
          if (layer.props.getIcon(layer.props.data[0]).url !== `/branding/planetslam/layer-icons/${expected}.svg`) throw Error(`Wrong artwork in ${id}`);
          if (!layer.props.pickable) throw Error(`Lost picking in ${id}`);
        }
        const flight = layers.find((layer: any) => layer.id === 'military-flights-layer');
        const vessel = layers.find((layer: any) => layer.id === 'military-vessels-layer');
        if (flight.props.getAngle(flights[0]) !== -90 || vessel.props.getAngle(vessels[0]) !== -270) throw Error('Heading lost');
        for (const kind of ['flight', 'vessel']) {
          const count = layers.find((layer: any) => layer.id === `military-${kind}-cluster-counts`);
          if (count.props.getText(count.props.data[0]) !== (kind === 'flight' ? '4' : '3')) throw Error('Cluster count lost');
        }
        // Check actual GPU picking after the platform artwork has loaded.
        const pickedFlight = flights[0];
        if (!pickedFlight) throw Error('Missing aircraft fixture for GPU picking');
        const point = map.maplibreMap.project([pickedFlight.lon, pickedFlight.lat]);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Aircraft artwork did not become pickable')), 15000);
          const check = () => {
            if (map.deckOverlay._deck.pickObject({ x: point.x, y: point.y, radius: 8 })?.object?.id === pickedFlight.id) { clearTimeout(timeout); resolve(); }
            else { map.maplibreMap.triggerRepaint(); requestAnimationFrame(check); }
          }; check();
        });
      }
      if (renderer === 'globe') {
        await map.whenViewportSettled(); map.globe.controls().autoRotate = false;
        map.setCenter(5, 0, 2); await map.whenViewportSettled();
      }
      return { aircraftTypes, vesselTypes };
    }, renderer);
    const map = page.locator('#platform-test-map');
    const aircraftArt = ['fighter', 'bomber', 'transport', 'tanker', 'awacs', 'recon', 'helicopter', 'drone', 'recon', 'plane', 'plane', 'plane'];
    const vesselArt = ['carrier', 'warship', 'warship', 'submarine', 'amphibious', 'patrol', 'auxiliary', 'research', 'icebreaker', 'ship', 'ship'];
    if (renderer !== 'deck') {
      for (const [i, type] of result.aircraftTypes.entries()) {
        const marker = renderer === 'svg' ? map.locator(`.military-flight-marker.${type} .planetslam-layer-glyph`) : map.locator(`[title="TEST-${type} (${type})"] .planetslam-layer-glyph`);
        await expect(marker).toHaveAttribute('src', `/branding/planetslam/layer-icons/platform-aircraft-${aircraftArt[i]}.svg`);
      }
      for (const [i, type] of result.vesselTypes.entries()) {
        const marker = renderer === 'svg' ? map.locator(`.military-vessel-marker.${type} .planetslam-layer-glyph`) : map.locator(`[title^="TEST-${type} ·"] .planetslam-layer-glyph`);
        await expect(marker).toHaveAttribute('src', `/branding/planetslam/layer-icons/platform-vessel-${vesselArt[i]}.svg`);
      }
      await expect(map.locator('[data-layer-icon="platform-aircraft-fighter"] .planetslam-layer-glyph')).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
      await expect(map.locator('.dark-vessel-indicator')).toBeVisible();
      await expect(map.locator('[data-layer-icon="platform-vessel-repair"] .planetslam-layer-glyph')).toHaveAttribute('src', '/branding/planetslam/layer-icons/platform-vessel-repair.svg');
      await expect(map.locator(renderer === 'svg' ? '.vessel-cluster .cluster-count' : '[title^="TEST vessel group"] .planetslam-marker-count')).toHaveText('3');
      if (renderer === 'svg') {
        await expect(map.locator('.flight-cluster .cluster-count')).toHaveText('4');
        await expect(map.locator('.military-flight-altitude').first()).toBeVisible();
        await expect(map.locator('.planetslam-emergency-badge')).toHaveText('7700');
        await expect(map.locator('.planetslam-emergency-badge')).toBeVisible();
      }
      await expect.poll(() => map.locator('img.planetslam-layer-glyph').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
      // Click the real marker and verify it still opens its aircraft popup.
      await map.locator('[data-layer-icon="platform-aircraft-fighter"]').click();
      await expect(page.locator('.map-popup')).toContainText('TEST-fighter');
      await page.locator('.map-popup .popup-close').click();
    }
    await expect(map.locator('.map-legend')).toHaveCount(0);
    await map.locator('.layer-toggle[data-layer="cables"]').click();
    await page.screenshot({ path: info.outputPath(`military-icons-${renderer}-${width}.png`) });
    // The user's layer toggle still removes/restores the entire military presentation.
    await map.locator('.layer-toggle[data-layer="military"]').click();
    if (renderer !== 'deck') await expect(map.locator('[data-layer-icon="platform-aircraft-fighter"]')).toHaveCount(0);
    await map.locator('.layer-toggle[data-layer="military"]').click();
    if (renderer !== 'deck') await expect(map.locator('[data-layer-icon="platform-aircraft-fighter"]')).toHaveCount(1);
  });
}
