import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelLayoutManager } from '@/app/panel-layout';
import { DEFAULT_MAP_LAYERS } from '@/config/panels';
import type { PlanetSlamDashboardId } from '@/config/planetslam-dashboards';
import type { PlanetSlamWorkspace } from '@/services/planetslam-dashboards';

vi.mock('@/config/brand', async importOriginal => ({
  ...await importOriginal<typeof import('@/config/brand')>(), IS_PLANETSLAM: true,
}));

interface Harness {
  ctx: { container: HTMLElement };
  planetSlamWorkspace: PlanetSlamWorkspace;
  initPlanetSlamDashboards(): void;
  refreshPlanetSlamDashboardMenu(): void;
  renameTab(id: string, name: string): unknown;
  restorePlanetSlamWorkspace: ReturnType<typeof vi.fn>;
  applyPlanetSlamDashboard: ReturnType<typeof vi.fn>;
}

const originalUrl = location.href;
const originalState = history.state;
const mapQuery = 'lat=35&lon=139&zoom=3&timeRange=48h&layers=hotspots';

function createManager(): Harness {
  const workspace: PlanetSlamWorkspace = { preset: 'full', customized: false,
    layers: { ...DEFAULT_MAP_LAYERS }, view: 'global', timeRange: '24h', zoom: 1 };
  const container = document.createElement('div');
  container.innerHTML = '<details class="ps-dashboard-picker"><summary>World <span>▾</span></summary>'
    + '<a data-variant="full">World</a><a data-variant="tech">Tech</a><a data-variant="energy">Energy</a></details>'
    + '<span class="ps-mobile-dashboard">World</span><div class="ps-saved-workspaces"></div>';
  const manager = Object.assign(Object.create(PanelLayoutManager.prototype) as Harness, {
    ctx: { container },
    planetSlamWorkspace: workspace,
    planetSlamNewWorkspace: false,
    checkoutReturnFocusController: new AbortController(),
    tabsState: { activeTabId: 'tab-a-1', tabs: [{ id: 'tab-a-1', name: 'World desk',
      panelSettings: {}, panelOrder: [], bottomSet: [], dashboard: workspace }] },
  });
  manager.restorePlanetSlamWorkspace = vi.fn(saved => {
    manager.planetSlamWorkspace = structuredClone(saved);
  });
  manager.applyPlanetSlamDashboard = vi.fn((id: PlanetSlamDashboardId) => {
    manager.planetSlamWorkspace = { ...manager.planetSlamWorkspace, preset: id };
    manager.refreshPlanetSlamDashboardMenu();
  });
  return manager;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { history.replaceState(originalState, '', originalUrl); });

describe('PlanetSlam preset URL ownership', () => {
  it('renders the menu repeatedly without changing the URL or browser history', () => {
    history.replaceState({ retained: true }, '', '/dashboard?dashboard=energy&variant=tech&' + mapQuery + '#map');
    const url = location.href;
    const replace = vi.spyOn(history, 'replaceState');
    const manager = createManager();
    manager.refreshPlanetSlamDashboardMenu();
    manager.refreshPlanetSlamDashboardMenu();
    expect(manager.ctx.container.querySelector('.ps-mobile-dashboard')?.textContent).toBe('World');
    expect(location.href).toBe(url);
    expect(replace).not.toHaveBeenCalled();
  });

  it('renames and persists a workspace without consuming URL commands', () => {
    history.replaceState({ retained: true }, '', '/dashboard?dashboard=tech&' + mapQuery + '#map');
    const url = location.href;
    const replace = vi.spyOn(history, 'replaceState');
    const manager = createManager();
    manager.renameTab('tab-a-1', 'My <desk>');
    expect(manager.ctx.container.querySelector('[data-dashboard-workspace]')?.textContent).toBe('My <desk>');
    expect(JSON.parse(localStorage.getItem('worldmonitor-tabs-v1:full')!).tabs[0].name).toBe('My <desk>');
    expect(location.href).toBe(url);
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['dashboard=tech', 'tech'], ['dashboard=full', 'full'], ['variant=cyber', 'tech'],
    ['variant=space', 'full'], ['dashboard=energy&variant=tech', 'energy'], ['dashboard=unknown', 'full'],
  ])('consumes %s once at initialization while retaining map parameters and history state', (query, preset) => {
    const state = { retained: true };
    history.replaceState(state, '', '/dashboard?' + query + '&' + mapQuery + '#map');
    const length = history.length;
    const replace = vi.spyOn(history, 'replaceState');
    const manager = createManager();
    manager.initPlanetSlamDashboards();
    expect(manager.planetSlamWorkspace.preset).toBe(preset);
    expect(location.pathname + location.search + location.hash).toBe('/dashboard?' + mapQuery + '#map');
    expect(history.state).toEqual(state);
    expect(history.length).toBe(length);
    expect(replace).toHaveBeenCalledOnce();
  });

  it('retains the entry command when applying its preset fails', () => {
    history.replaceState(null, '', '/dashboard?dashboard=tech&' + mapQuery);
    const url = location.href;
    const replace = vi.spyOn(history, 'replaceState');
    const manager = createManager();
    const error = new Error('Synthetic preset failure');
    manager.applyPlanetSlamDashboard.mockImplementation(() => { throw error; });
    expect(() => manager.initPlanetSlamDashboards()).toThrow(error);
    expect(location.href).toBe(url);
    expect(replace).not.toHaveBeenCalled();
  });
});
