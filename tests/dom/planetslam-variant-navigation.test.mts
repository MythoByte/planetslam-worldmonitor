import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/brand', () => ({
  IS_PLANETSLAM: true,
  BRAND: { name: 'PlanetSlam', wordmark: 'PLANETSLAM', source: '' },
}));

const originalUrl = window.location.href;

afterEach(() => {
  window.location.href = originalUrl;
  vi.unstubAllGlobals();
});

async function select(url: string) {
  window.location.href = url;
  vi.resetModules();
  return import('@/config/variant');
}

describe('PlanetSlam same-origin editions', () => {
  it('seeds the Space dashboard with free panels and focused map layers', async () => {
    await select('https://planetslam.com/dashboard?variant=space');
    const panels = await import('@/config/panels');
    const { getAllowedLayerKeys } = await import('@/config/map-layer-definitions');
    const settings = panels.getInitialPanelSettingsForVariant('space');
    const expected = ['map', 'space-satellites', 'space-observing', 'space-missions', 'space-cameras', 'space-launches', 'space-weather',
      'space-apod', 'space-news', 'space-spacex', 'space-neo', 'space-solar',
      'space-events', 'space-health'];
    expect(Object.entries(settings).filter(([, value]) => value.enabled).map(([key]) => key).sort())
      .toEqual([...expected].sort());
    for (const key of expected) {
      expect(panels.isPanelNativeToVariant(key, 'space')).toBe(true);
      expect(panels.isPanelEntitled(key, settings[key]!, false)).toBe(true);
    }
    expect(panels.getEffectivePanelConfig('map', 'space').name).toBe('Space & Orbit Map');
    expect(panels.getVariantPanelCategories(settings, 'space').map(category => category.key))
      .toEqual(['core', 'space']);
    const allowed = getAllowedLayerKeys('space');
    for (const key of ['satellites', 'spaceports', 'dayNight', 'webcams'] as const) {
      expect(panels.DEFAULT_MAP_LAYERS[key]).toBe(true);
      expect(allowed.has(key)).toBe(true);
    }
    expect(panels.DEFAULT_MAP_LAYERS.conflicts).toBe(false);
    expect(panels.DEFAULT_MAP_LAYERS.military).toBe(false);
  });

  it('opens all seven edition deep links on the LAN host', async () => {
    for (const edition of ['full', 'tech', 'finance', 'commodity', 'energy', 'happy', 'space']) {
      const { SITE_VARIANT } = await select(`https://10.10.10.50:18003/dashboard?variant=${edition}`);
      expect(SITE_VARIANT).toBe(edition);
    }
  });

  it('defaults to World for absent or invalid selections, even with a stored edition', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'happy' });
    for (const suffix of ['', '?variant=unknown', '?variant=https://worldmonitor.app']) {
      const { SITE_VARIANT } = await select(`https://planetslam.com/dashboard${suffix}`);
      expect(SITE_VARIANT).toBe('full');
    }
  });

  it('uses shareable same-origin edition links including World', async () => {
    await select('https://planetslam.com/dashboard?variant=happy');
    const { variantSwitcherHref } = await import('@/app/panel-layout');
    for (const edition of ['full', 'tech', 'finance', 'commodity', 'energy', 'happy', 'space'] as const) {
      expect(variantSwitcherHref(edition, 'happy', false)).toBe(`/dashboard?variant=${edition}`);
    }
  });

  it('retains the edition when map state rebuilds the share URL', async () => {
    await select('https://10.10.10.50:18003/dashboard?variant=energy');
    const { EventHandlerManager } = await import('@/app/event-handlers');
    const manager = new EventHandlerManager({
      container: document.createElement('div'),
      map: {
        getState: () => ({ view: 'global', zoom: 2, timeRange: '24h', layers: {} }),
        getCenter: () => ({ lat: 10, lon: 20 }),
      },
    } as never, {} as never);
    const url = new URL(manager.getShareUrl()!);
    expect(url.origin).toBe('https://10.10.10.50:18003');
    expect(url.searchParams.get('variant')).toBe('energy');
    expect(url.searchParams.get('lat')).toBe('10.0000');
    expect(url.searchParams.get('zoom')).toBe('2.00');
  });
});
