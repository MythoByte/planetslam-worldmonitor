import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/config/brand', () => ({ IS_PLANETSLAM: true }));
import { loadTabsState, normalizeTabsState } from '@/services/tab-store';

const world = { activeTabId: 'tab-world-a', tabs: [{ id: 'tab-world-a', name: 'Main', panelSettings: { politics: { name: 'Politics', enabled: true, priority: 1 } }, panelOrder: ['politics'], bottomSet: [] }] };
const tech = { activeTabId: 'tab-tech-a', tabs: [{ id: 'tab-tech-a', name: '<My desk>', panelSettings: { security: { name: 'Security', enabled: false, priority: 1 } }, panelOrder: ['security'], bottomSet: ['security'] }] };
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('PlanetSlam shared workspace migration', () => {
  it('keeps each edition snapshot and its original archive, and selects the previously active edition', () => {
    const originalWorld = JSON.stringify(world);
    const originalTech = JSON.stringify(tech);
    localStorage.setItem('worldmonitor-tabs-v1:full', originalWorld);
    localStorage.setItem('worldmonitor-tabs-v1:tech', originalTech);
    localStorage.setItem('worldmonitor-panel-layout-variant', 'tech');
    const merged = loadTabsState()!;
    expect(merged.tabs).toHaveLength(2);
    expect(merged.activeTabId).toBe('tab-tech-a');
    expect(merged.tabs[1]?.panelSettings).toEqual(tech.tabs[0]!.panelSettings);
    expect(merged.tabs[1]?.bottomSet).toEqual(['security']);
    expect(merged.tabs[1]?.dashboard?.preset).toBe('tech');
    expect(localStorage.getItem('planetslam-workspaces-legacy-world-v1')).toBe(originalWorld);
    expect(localStorage.getItem('worldmonitor-tabs-v1:tech')).toBe(originalTech);
    expect(loadTabsState()).toEqual(merged);
  });

  it('migrates a visitor who only has Tech tabs and skips a malformed unrelated edition', () => {
    localStorage.setItem('worldmonitor-tabs-v1:tech', JSON.stringify(tech));
    localStorage.setItem('worldmonitor-tabs-v1:energy', '{broken');
    expect(loadTabsState()?.tabs).toHaveLength(1);
    expect(loadTabsState()?.tabs[0]?.panelSettings).toEqual(tech.tabs[0]!.panelSettings);
  });

  it('leaves the existing World workspace usable when archiving is rejected', () => {
    const original = JSON.stringify(world);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'worldmonitor-tabs-v1:full' ? original : null,
      setItem: () => { throw new Error('Synthetic quota failure'); },
    });
    expect(loadTabsState()).toEqual(world);
  });

  it('renames colliding edition IDs and keeps the selected edition active', () => {
    const collidingTech = structuredClone(tech);
    collidingTech.activeTabId = world.activeTabId;
    collidingTech.tabs[0]!.id = world.activeTabId;
    localStorage.setItem('worldmonitor-tabs-v1:full', JSON.stringify(world));
    localStorage.setItem('worldmonitor-tabs-v1:tech', JSON.stringify(collidingTech));
    localStorage.setItem('worldmonitor-panel-layout-variant', 'tech');
    const merged = loadTabsState()!;
    expect(merged.tabs[0]?.id).toBe(world.activeTabId);
    expect(merged.tabs[1]?.id).not.toBe(world.activeTabId);
    expect(merged.activeTabId).toBe(merged.tabs[1]?.id);
    expect(merged.tabs[1]?.name).toBe('Tech: <My desk>');
    expect(loadTabsState()).toEqual(merged);
  });

  it('restores boolean map settings only on the edition that owned them', () => {
    localStorage.setItem('worldmonitor-tabs-v1:full', JSON.stringify(world));
    localStorage.setItem('worldmonitor-tabs-v1:tech', JSON.stringify(tech));
    localStorage.setItem('worldmonitor-panel-layout-variant', 'tech');
    localStorage.setItem('worldmonitor-layers', JSON.stringify({ hotspots: false, datacenters: false, cables: 'invalid', unknown: true }));
    const merged = loadTabsState()!;
    expect(merged.tabs[0]?.dashboard?.layers.hotspots).toBe(true);
    expect(merged.tabs[1]?.dashboard?.layers.hotspots).toBe(false);
    expect(merged.tabs[1]?.dashboard?.layers.datacenters).toBe(false);
    expect(merged.tabs[1]?.dashboard?.layers.cables).toBe(true);
    expect(merged.tabs[1]?.dashboard?.layers).not.toHaveProperty('unknown');
  });

  it('keeps preset layers when legacy map settings are malformed', () => {
    localStorage.setItem('worldmonitor-tabs-v1:tech', JSON.stringify(tech));
    localStorage.setItem('worldmonitor-panel-layout-variant', 'tech');
    localStorage.setItem('worldmonitor-layers', 'null');
    expect(loadTabsState()?.tabs[0]?.dashboard?.layers.datacenters).toBe(true);
  });

  it('recovers other editions even when the World payload is malformed', () => {
    localStorage.setItem('worldmonitor-tabs-v1:full', '{broken');
    localStorage.setItem('worldmonitor-tabs-v1:tech', JSON.stringify(tech));
    expect(loadTabsState()?.tabs[0]?.panelSettings).toEqual(tech.tabs[0]!.panelSettings);
    expect(localStorage.getItem('planetslam-workspaces-legacy-world-v1')).toBe('{broken');
  });

  it('preserves the original archive and skips migration after it completes', () => {
    localStorage.setItem('planetslam-workspaces-legacy-world-v1', 'original archive');
    localStorage.setItem('worldmonitor-tabs-v1:full', JSON.stringify(world));
    const migrated = loadTabsState()!;
    expect(localStorage.getItem('planetslam-workspaces-legacy-world-v1')).toBe('original archive');
    expect(localStorage.getItem('planetslam-workspaces-migrated-v1')).toBe('1');
    localStorage.setItem('worldmonitor-tabs-v1:tech', JSON.stringify(tech));
    expect(loadTabsState()).toEqual(migrated);
  });

  it('returns recovered tabs but does not mark migration complete when saving fails', () => {
    const values: Record<string, string> = { 'worldmonitor-tabs-v1:tech': JSON.stringify(tech) };
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => {
        if (key === 'worldmonitor-tabs-v1:full') throw new Error('Synthetic quota failure');
        values[key] = value;
      },
      removeItem: (key: string) => { delete values[key]; },
    });
    expect(loadTabsState()?.tabs[0]?.id).toBe(tech.activeTabId);
    expect(values['planetslam-workspaces-migrated-v1']).toBeUndefined();
    expect(values['worldmonitor-tabs-v1:tech']).toBe(JSON.stringify(tech));
  });

  it('leaves migration pending when there are no usable tabs', () => {
    localStorage.setItem('worldmonitor-tabs-v1:tech', '{broken');
    expect(loadTabsState()).toBeNull();
    expect(localStorage.getItem('planetslam-workspaces-migrated-v1')).toBeNull();
  });

  it('rejects invalid map metadata without discarding a usable panel workspace', () => {
    const state = structuredClone(world);
    Object.assign(state.tabs[0]!, { dashboard: { preset: 'energy', customized: true, view: 'evil', zoom: 2, timeRange: '24h', layers: {} } });
    const loaded = normalizeTabsState(state)!;
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.tabs[0]?.dashboard).toBeUndefined();
    expect(loaded.tabs[0]?.panelOrder).toEqual(['politics']);
  });
});
