import { expect, test } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam GDELT reports');

for (const width of [1440, 390]) {
  test(`GDELT report sources and states on the dashboard at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', { initializeOnce: {
      sessionKey: 'gdelt-report-profile', clearStorage: true, localStorage: {
        'worldmonitor-theme': 'dark', 'mobile-map-collapsed': 'false',
        'worldmonitor-panels': JSON.stringify({ politics: { name: 'World News', enabled: true, priority: 0 } }),
      },
    } });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    let state: 'reports' | 'empty' | 'stale' | 'unavailable' = 'reports';
    let requests = 0;
    await page.route('**/api/attack-reports', route => {
      requests++;
      const report = { id: 'gdelt-air-101', latitude: 0, longitude: 90, locationName: 'Synthetic event area', locationPrecision: 'place',
        sourceUrl: 'https://example.com/report', publisher: 'example.com', eventDate: new Date().toISOString().slice(0,10), indexedAt: Date.now(),
        articleCount: 2, kind: 'aerial', verification: 'reported' };
      return route.fulfill({ json: { status: state === 'stale' ? 'stale' : state === 'unavailable' ? 'unavailable' : 'fresh',
        updatedAt: Date.now(), latestBatchAt: Date.now(), coverageStart: Date.now()-3600000, completeWindow: false, limited: false,
        reports: state === 'reports' || state === 'stale' ? [report, { ...report, id: 'gdelt-air-102', indexedAt: Date.now()-25*3600000 }] : [] } });
    });
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
    await expect(page.locator('.gdelt-attack-marker')).toHaveCount(1);
    await expect(page.locator('.gdelt-attack-status summary')).toContainText('1 reports');
    const marker = page.locator('.gdelt-attack-marker');
    await expect(marker).toHaveAttribute('href', '/branding/planetslam/layer-icons/hazard-air-attack.svg');
    await marker.focus(); await marker.press('Enter');
    await expect(page.locator('.gdelt-attack-report[data-selected="true"]')).toContainText('Event date');
    await expect(page.locator('.gdelt-attack-report')).toContainText('GDELT indexed');
    await expect(page.locator('.gdelt-attack-status')).toContainText('Not independently confirmed');
    const link = page.locator('.gdelt-attack-report a');
    await expect(link).toHaveAttribute('href', 'https://example.com/report');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await link.click({ trial: true });
    await page.screenshot({ path: info.outputPath(`gdelt-reports-${width}.png`) });
    if (width === 1440) {
      const toggle = page.locator('.layer-toggle[data-layer="attackReports"]');
      await toggle.click();
      await expect(page.locator('.gdelt-attack-marker')).toHaveCount(0);
      await expect(page.locator('.gdelt-attack-status')).toBeHidden();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-layers')||'{}').attackReports)).toBe(false);
      await expect.poll(() => {
        const layers = new URL(page.url()).searchParams.get('layers');
        return layers !== null && !layers.split(',').includes('attackReports');
      }).toBe(true);
      const beforeReload = requests;
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 60_000 });
      await expect(toggle).not.toHaveClass(/active/); expect(requests).toBe(beforeReload);
      state = 'empty'; await toggle.click();
      await expect(page.locator('.gdelt-attack-status summary')).toContainText('No recent reports');
      await expect(page.locator('.gdelt-attack-marker')).toHaveCount(0);
      await toggle.click(); state = 'stale'; await toggle.click();
      await expect(page.locator('.gdelt-attack-status summary')).toContainText('Feed stale');
      await expect(page.locator('.gdelt-attack-marker')).toHaveCount(1);
      await toggle.click(); state = 'unavailable'; await toggle.click();
      await expect(page.locator('.gdelt-attack-status summary')).toContainText('Feed unavailable');
      await expect(page.locator('.gdelt-attack-marker')).toHaveCount(0);
    }
  });
}

for (const renderer of ['svg', 'globe', 'deck'] as const) {
  test(`reported attacks render, select and hide in ${renderer}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto('/tests/map-harness.html');
    await page.waitForFunction(() => (window as any).__mapHarness?.ready);
    await page.evaluate(async renderer => {
      (window as any).__mapHarness.destroy(); document.getElementById('app')?.replaceChildren();
      document.body.classList.remove('e2e-deterministic');
      const path = renderer === 'svg' ? '/src/components/Map.ts' : renderer === 'globe' ? '/src/components/GlobeMap.ts' : '/src/components/DeckGLMap.ts';
      const module = await import(/* @vite-ignore */ path);
      const container = document.createElement('div'); container.id = 'gdelt-report-map';
      container.style.cssText = 'position:fixed;inset:10px;background:#10212a'; document.body.append(container);
      const Constructor = module.MapComponent ?? module.GlobeMap ?? module.DeckGLMap;
      const map = new Constructor(container,{view:'global',layers:{attackReports:true},timeRange:'all',zoom:2,pan:{x:0,y:0}},{chrome:true});
      (window as any).attackMap = map;
      if (map.whenReady) await map.whenReady();
      if (renderer === 'deck') {
        map.maplibreMap.setStyle({version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#10212a'}}]});
        await new Promise<void>((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(new Error('Deck overlay not initialized')),20000);
          const check=()=>{if(map.deckOverlay?._deck?.isInitialized){clearTimeout(timeout);resolve();}else requestAnimationFrame(check);};check();
        });
      }
      window.addEventListener('planetslam:attack-report-select', (e: any) => { document.body.dataset.attackSelected = e.detail; });
      map.setAttackReports([{ id:'gdelt-air-101',latitude:15,longitude:0,locationName:'Synthetic event area',locationPrecision:'place',
        sourceUrl:'https://example.com/report',publisher:'example.com',eventDate:new Date().toISOString().slice(0,10),indexedAt:Date.now(),articleCount:2,kind:'aerial',verification:'reported' }]);
      if (renderer === 'globe') {
        await map.whenViewportSettled(); map.globe.controls().autoRotate=false; map.setCenter(15,0,2); await map.whenViewportSettled();
      }
      if (renderer === 'deck') {
        const layer = map.buildLayers().find((l:any)=>l.id==='gdelt-attack-reports');
        if (layer?.constructor.layerName!=='IconLayer' || layer.props.data.length!==1) throw new Error('Reported attack layer missing');
        if (!map.getTooltip({layer,object:layer.props.data[0]}).html.includes('Unverified')) throw new Error('Verification label missing');
        layer.props.onClick({object:layer.props.data[0]});
      }
    }, renderer);
    if (renderer==='svg') {
      await expect(page.locator('.gdelt-attack-marker')).toHaveCount(1);
      await page.locator('.gdelt-attack-marker').click();
    } else if (renderer==='globe') {
      const marker=page.locator('[title^="Reported aerial attack"]'); await expect(marker.first()).toBeVisible();
      await marker.first().click();
    } else {
      await expect.poll(()=>page.evaluate(()=>{
        const map=(window as any).attackMap;
        const deck=map.deckOverlay?._deck;
        if (!deck?.isInitialized) return false;
        return deck.pickObjects({x:0,y:0,width:1260,height:830}).some((p:any)=>p.object?.id==='gdelt-air-101');
      }),{timeout:20000}).toBe(true);
    }
    await expect(page.locator('body')).toHaveAttribute('data-attack-selected','gdelt-air-101');
    await page.screenshot({path:info.outputPath(`gdelt-${renderer}.png`)});
    await page.evaluate(()=>(window as any).attackMap.setLayers({attackReports:false}));
    if (renderer==='svg') await expect(page.locator('.gdelt-attack-marker')).toHaveCount(0);
    if (renderer==='globe') await expect(page.locator('[title^="Reported aerial attack"]')).toHaveCount(0);
    if (renderer==='deck') expect(await page.evaluate(()=>(window as any).attackMap.buildLayers().some((l:any)=>l.id==='gdelt-attack-reports'))).toBe(false);
    await page.evaluate(()=>(window as any).attackMap.destroy());
  });
}
