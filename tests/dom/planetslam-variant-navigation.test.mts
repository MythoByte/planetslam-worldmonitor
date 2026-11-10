import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/brand', () => ({
  IS_PLANETSLAM: true,
  BRAND: { name: 'PlanetSlam', wordmark: 'PLANETSLAM', source: '' },
}));
const originalUrl = window.location.href;
afterEach(() => {
  window.location.href = originalUrl;
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function select(url: string) {
  window.location.href = url;
  vi.resetModules();
  return import('@/config/variant');
}

describe('PlanetSlam dashboard presets in one World workspace', () => {
  it('keeps every legacy link on the full runtime and resolves its preset without losing map parameters', async () => {
    for (const [legacy, preset] of [['full','full'], ['tech','tech'], ['finance','finance'], ['commodity','commodity'], ['energy','energy'], ['happy','happy'], ['space','full'], ['earth','full'], ['cyber','tech']]) {
      const { SITE_VARIANT } = await select(`https://planetslam.com/dashboard?variant=${legacy}&timeRange=48h`);
      expect(SITE_VARIANT).toBe('full');
      const { requestedPlanetSlamDashboard } = await import('@/services/planetslam-dashboards');
      expect(requestedPlanetSlamDashboard(window.location.search)).toBe(preset);
      expect(new URLSearchParams(window.location.search).get('timeRange')).toBe('48h');
    }
  });

  it('offers valid, editable panel and layer selections for all six presets', async () => {
    await select('https://planetslam.com/dashboard');
    const { PLANETSLAM_DASHBOARDS } = await import('@/config/planetslam-dashboards');
    const { buildPlanetSlamDashboard } = await import('@/services/planetslam-dashboards');
    const { ALL_PANELS, DEFAULT_MAP_LAYERS } = await import('@/config/panels');
    const { getAllowedLayerKeys } = await import('@/config/map-layer-definitions');
    const allowed = getAllowedLayerKeys('full');
    for (const preset of PLANETSLAM_DASHBOARDS) {
      for (const id of preset.panels) expect(ALL_PANELS[id], `${preset.id}: ${id}`).toBeDefined();
      for (const layer of preset.layers) expect(allowed.has(layer), `${preset.id}: ${layer}`).toBe(true);
      const widget = { name: 'My widget', enabled: true, priority: 1 };
      const built = buildPlanetSlamDashboard(preset.id, { 'cw-custom': widget }, DEFAULT_MAP_LAYERS);
      expect(built.panelSettings['cw-custom']).toEqual(widget);
      expect(built.panelSettings.map?.enabled).toBe(true);
      expect(built.panelSettings['cw-custom']).not.toBe(widget);
      expect(built.panelOrder).toEqual(preset.panels);
    }
  });

  it('keeps every existing Cyber tool available in the Tech preset', async () => {
    await select('https://planetslam.com/dashboard');
    const { buildPlanetSlamDashboard } = await import('@/services/planetslam-dashboards');
    const { DEFAULT_MAP_LAYERS } = await import('@/config/panels');
    const { panelSettings } = buildPlanetSlamDashboard('tech', {}, DEFAULT_MAP_LAYERS);
    for (const name of ['alerts','attention','brief','environment','health','incidents','kev','research','watchlist']) {
      expect(panelSettings[`cyber-${name}`]?.enabled).toBe(true);
    }
    expect(panelSettings.security?.enabled).toBe(true);
    expect(panelSettings['cyber-news']?.enabled).toBe(false);
  });

  it('defaults to the World runtime for absent or invalid selections', async () => {
    for (const suffix of ['', '?dashboard=unknown', '?variant=https://worldmonitor.app']) {
      const { SITE_VARIANT } = await select(`https://planetslam.com/dashboard${suffix}`);
      expect(SITE_VARIANT).toBe('full');
      const { requestedPlanetSlamDashboard } = await import('@/services/planetslam-dashboards');
      expect(requestedPlanetSlamDashboard(window.location.search)).toBeNull();
    }
  });

  it('reports a successful in-place switch to agents, including switching back to World', async () => {
    await select('https://planetslam.com/dashboard');
    const { EventHandlerManager } = await import('@/app/event-handlers');
    const { applyWebMcpSwitchMonitor } = await import('@/app/webmcp-dashboard');
    const container = document.createElement('div');
    for (const id of ['tech', 'full']) {
      const link = document.createElement('a');
      link.className = 'variant-option'; link.dataset.variant = id; link.href = `/dashboard?dashboard=${id}`;
      container.append(link);
    }
    const apply = vi.fn();
    const ctx = { container, isDestroyed: false, dashboardFeedVariant: 'tech' } as never;
    const manager = new EventHandlerManager(ctx, { applyDashboardPreset: apply } as never);
    for (const id of ['tech', 'full'] as const) {
      const result = await applyWebMcpSwitchMonitor(ctx, 'full', id, variant => manager.navigateToVisibleVariant(variant));
      expect(result.ok).toBe(true);
      expect(result.navigation).toBe('in_place');
      expect(apply).toHaveBeenLastCalledWith(id);
    }
  });

  it('shares the selected preset but keeps routine map URL updates free of preset commands', async () => {
    await select('https://10.10.10.50:18003/dashboard');
    const { EventHandlerManager } = await import('@/app/event-handlers');
    const manager = new EventHandlerManager({
      container: document.createElement('div'), dashboardFeedVariant: 'energy',
      map: {
        getState: () => ({ view: 'global', zoom: 2, timeRange: '24h', layers: {} }),
        getCenter: () => ({ lat: 10, lon: 20 }),
      },
    } as never, {} as never);
    const shared = new URL(manager.getShareUrl()!);
    expect(shared.origin).toBe('https://10.10.10.50:18003');
    expect(shared.searchParams.get('dashboard')).toBe('energy');
    expect(shared.searchParams.get('lat')).toBe('10.0000');
    expect(new URL(manager.getShareUrl(false)!).searchParams.has('dashboard')).toBe(false);
  });
});
