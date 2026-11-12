import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP_LAYERS } from '@/config/panels';
import { PanelLayoutManager } from '@/app/panel-layout';
import type { PlanetSlamWorkspace } from '@/services/planetslam-dashboards';

vi.mock('@/config/brand', async importOriginal => ({
  ...await importOriginal<typeof import('@/config/brand')>(), IS_PLANETSLAM: true,
}));

interface Harness {
  applyingPlanetSlamDashboard: boolean;
  planetSlamWorkspace: PlanetSlamWorkspace;
  callbacks: { applyDashboardMap: ReturnType<typeof vi.fn> };
  restorePlanetSlamWorkspace(saved: PlanetSlamWorkspace): void;
  applyPlanetSlamDashboard(id: string): void;
  createAndActivateTab(name: string): void;
  switchToTab(id: string): void;
  deleteTab(id: string): void;
  markPlanetSlamCustomized(force: boolean): void;
  applyTabPanelState: ReturnType<typeof vi.fn>;
  capturePlanetSlamWorkspace: ReturnType<typeof vi.fn>;
  restorePlanetSlamSizes: ReturnType<typeof vi.fn>;
  snapshotActiveTab: ReturnType<typeof vi.fn>;
}

function createManager(): Harness {
  const workspace: PlanetSlamWorkspace = { preset: 'full', customized: false,
    layers: { ...DEFAULT_MAP_LAYERS }, view: 'global', timeRange: '24h', zoom: 1 };
  const snapshot = { panelSettings: { politics: { name: 'Politics', enabled: true, priority: 1 } },
    panelOrder: ['politics'], bottomSet: [], dashboard: workspace };
  const manager = Object.assign(Object.create(PanelLayoutManager.prototype) as Harness, {
    ctx: { panelSettings: snapshot.panelSettings, mapLayers: { ...workspace.layers },
      dashboardFeedVariant: 'full', container: document.createElement('div') },
    callbacks: { invalidateNewsHydration: vi.fn(), applyDashboardMap: vi.fn(state => state.layers) },
    applyingPlanetSlamDashboard: false,
    planetSlamWorkspace: structuredClone(workspace),
    tabsState: { activeTabId: 'tab-a-1', tabs: [
      { id: 'tab-a-1', name: 'World', ...snapshot },
      { id: 'tab-b-2', name: 'Other', ...snapshot },
    ] },
    snapshotActiveTab: vi.fn(() => ({ persisted: true })),
    captureCurrentTabState: vi.fn(() => ({ snapshot, persisted: true })),
    restorePlanetSlamSizes: vi.fn(),
    applyTabPanelState: vi.fn(),
    refreshPlanetSlamDashboardMenu: vi.fn(),
    updateTabCapLock: vi.fn(),
    isProTierResolvedOrFallback: vi.fn(() => false),
  });
  manager.capturePlanetSlamWorkspace = vi.fn(() => structuredClone(manager.planetSlamWorkspace));
  return manager;
}

beforeEach(() => { localStorage.clear(); });

describe('PlanetSlam workspace transition cleanup', () => {
  it.each(['restore', 'preset'] as const)('resumes customization tracking when a %s map callback throws', operation => {
    const manager = createManager();
    const error = new Error('Synthetic map failure');
    manager.callbacks.applyDashboardMap.mockImplementation(() => {
      expect(manager.applyingPlanetSlamDashboard).toBe(true);
      throw error;
    });
    expect(() => operation === 'restore'
      ? manager.restorePlanetSlamWorkspace(manager.planetSlamWorkspace)
      : manager.applyPlanetSlamDashboard('tech')).toThrow(error);
    expect(manager.applyingPlanetSlamDashboard).toBe(false);
    manager.markPlanetSlamCustomized(true);
    expect(manager.planetSlamWorkspace.customized).toBe(true);
    expect(manager.capturePlanetSlamWorkspace).toHaveBeenCalledOnce();
  });

  it.each(['create', 'switch', 'delete'] as const)('resumes customization tracking when %s fails to apply panels', operation => {
    const manager = createManager();
    const error = new Error('Synthetic panel failure');
    manager.applyTabPanelState.mockImplementation(() => {
      expect(manager.applyingPlanetSlamDashboard).toBe(true);
      throw error;
    });
    expect(() => {
      if (operation === 'create') manager.createAndActivateTab('New desk');
      else if (operation === 'switch') manager.switchToTab('tab-b-2');
      else manager.deleteTab('tab-a-1');
    }).toThrow(error);
    expect(manager.applyingPlanetSlamDashboard).toBe(false);
    manager.markPlanetSlamCustomized(true);
    expect(manager.planetSlamWorkspace.customized).toBe(true);
    expect(manager.capturePlanetSlamWorkspace).toHaveBeenCalledOnce();
  });

  it('clears the guard when preset application fails before or after the map callback', () => {
    for (const failure of ['restorePlanetSlamSizes', 'applyTabPanelState', 'snapshotActiveTab'] as const) {
      const manager = createManager();
      const error = new Error('Synthetic ' + failure + ' failure');
      if (failure === 'snapshotActiveTab') {
        manager.snapshotActiveTab.mockImplementationOnce(() => ({ persisted: true }))
          .mockImplementationOnce(() => { throw error; });
      } else manager[failure].mockImplementation(() => { throw error; });
      expect(() => manager.applyPlanetSlamDashboard('tech')).toThrow(error);
      expect(manager.applyingPlanetSlamDashboard).toBe(false);
    }
  });

  it.each(['restore', 'preset'] as const)('suppresses callback-driven customization during successful %s and clears the guard afterward', operation => {
    const manager = createManager();
    manager.callbacks.applyDashboardMap.mockImplementation(state => {
      expect(manager.applyingPlanetSlamDashboard).toBe(true);
      manager.markPlanetSlamCustomized(true);
      expect(manager.planetSlamWorkspace.customized).toBe(false);
      return state.layers;
    });
    if (operation === 'restore') manager.restorePlanetSlamWorkspace(manager.planetSlamWorkspace);
    else manager.applyPlanetSlamDashboard('tech');
    expect(manager.applyingPlanetSlamDashboard).toBe(false);
    expect(manager.planetSlamWorkspace.customized).toBe(false);
  });
});
