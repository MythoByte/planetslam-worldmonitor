import assert from 'node:assert/strict';
import { seedProfile, waitForBoot, waitForMap } from '../.agents/skills/verify-worldmonitor/steps/_profile.mjs';

/** Actual desktop/mobile controls; runs against Vite or the LAN Docker build. */
export default async function ({ page, base, shot, log }) {
  await seedProfile(page, { localStorage: {
    'mobile-map-collapsed': 'false',
    'wm-pro-banner-launched-dismissed': null,
  } });
  const origin = new URL(base).origin;
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const ready = async (edition) => {
    if (process.env.WM_VERIFY_LIVE !== '1') await waitForBoot(page);
    await waitForMap(page);
    await page.locator(`.variant-option.active[data-variant="${edition}"]`).waitFor({ state: 'attached' });
    assert.equal(new URL(page.url()).origin, origin);
    assert.equal(new URL(page.url()).searchParams.get('variant'), edition);
    const panel = edition === 'happy' ? 'positive-feed' : 'live-news';
    await page.locator(`#panelsGrid .panel[data-panel="${panel}"]`).waitFor({ state: 'attached' });
    assert.equal(await page.locator('.pro-banner').count(), 0);
    for (const href of await page.locator('.variant-option').evaluateAll(links => links.map(link => link.href))) {
      assert.equal(new URL(href).origin, origin);
    }
  };
  await page.goto(`${base}/dashboard?variant=full`, { waitUntil: 'domcontentloaded' });
  await ready('full');
  await shot('world-before-switch');
  for (const edition of ['tech', 'finance', 'commodity', 'energy', 'happy', 'full']) {
    await page.locator(`.variant-option[data-variant="${edition}"]`).click();
    await page.waitForURL(url => url.searchParams.get('variant') === edition);
    await ready(edition);
    log('desktop-edition', { edition, sameOrigin: true, panelsMounted: true });
    if (edition === 'tech' || edition === 'happy') await shot(`${edition}-desktop`);
    if (edition === 'tech') {
      await page.locator('#regionSelect').selectOption('eu');
      await page.waitForURL(url => url.searchParams.get('variant') === 'tech' && url.searchParams.has('zoom'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready('tech');
      log('map-url-and-reload', { edition: 'tech', preserved: true });
    }
  }
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await ready('happy');
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await ready('full');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready('full');
  log('history-and-reload', { back: 'happy', forward: 'full', reload: 'full' });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const edition of ['tech', 'finance', 'commodity', 'energy', 'happy', 'full']) {
    await page.locator('[data-mobile-tab="more"]').click();
    await page.locator('#mobileMenu.open').waitFor();
    await page.locator(`.mobile-menu-variant[data-variant="${edition}"]`).click();
    await page.waitForURL(url => url.searchParams.get('variant') === edition);
    await ready(edition);
    log('mobile-edition', { edition, sameOrigin: true });
    if (edition === 'happy') {
      await shot('happy-mobile');
      await page.locator('[data-mobile-tab="more"]').click();
      await page.locator('#mobileMenu.open').waitFor();
      await shot('mobile-edition-menu');
      await page.locator('[data-mobile-tab="more"]').click();
    }
  }
  assert.deepEqual(failures, [], 'edition switching must not throw browser errors');
  log('result', { desktopEditions: 6, mobileEditions: 6, origin, pageErrors: failures });
}
