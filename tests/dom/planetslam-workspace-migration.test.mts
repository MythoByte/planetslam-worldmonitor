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

  it('rejects invalid map metadata without discarding a usable panel workspace', () => {
    const state = structuredClone(world);
    Object.assign(state.tabs[0]!, { dashboard: { preset: 'energy', customized: true, view: 'evil', zoom: 2, timeRange: '24h', layers: {} } });
    const loaded = normalizeTabsState(state)!;
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.tabs[0]?.dashboard).toBeUndefined();
    expect(loaded.tabs[0]?.panelOrder).toEqual(['politics']);
  });
});
