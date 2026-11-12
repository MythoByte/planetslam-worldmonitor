import { describe, expect, it } from 'vitest';
import { PLANETSLAM_DASHBOARDS } from '@/config/planetslam-dashboards';
import { isPlanetSlamWorkspace } from '@/services/planetslam-dashboards';
import { normalizeTabsState } from '@/services/tab-store';

const workspace = {
  preset: 'full', customized: false, view: 'global', timeRange: '24h',
  zoom: 1, layers: { hotspots: true, weather: false },
};

describe('PlanetSlam saved workspace validation', () => {
  it('accepts every dashboard, map view, and time range', () => {
    for (const { id } of PLANETSLAM_DASHBOARDS) {
      expect(isPlanetSlamWorkspace({ ...workspace, preset: id })).toBe(true);
    }
    for (const view of ['global', 'america', 'mena', 'eu', 'asia', 'latam', 'africa', 'oceania']) {
      expect(isPlanetSlamWorkspace({ ...workspace, view })).toBe(true);
    }
    for (const timeRange of ['1h', '6h', '24h', '48h', '7d', 'all']) {
      expect(isPlanetSlamWorkspace({ ...workspace, timeRange })).toBe(true);
    }
  });

  it('accepts optional metadata and inclusive numeric limits without mutating the input', () => {
    for (const zoom of [0, 1.5, 24]) {
      const saved = { ...workspace, zoom, customized: true, panelRows: { politics: 1, tech: 4 },
        panelColumns: { politics: 1, tech: 3 }, center: { lat: -90, lon: 180 } };
      const before = structuredClone(saved);
      expect(isPlanetSlamWorkspace(saved)).toBe(true);
      expect(saved).toEqual(before);
    }
    expect(isPlanetSlamWorkspace({ ...workspace, center: { lat: 90, lon: -180 } })).toBe(true);
    expect(isPlanetSlamWorkspace({ ...workspace, panelRows: {}, panelColumns: {}, layers: {} })).toBe(true);
    // Stored layer maps may predate the current registry or include an unknown layer.
    expect(isPlanetSlamWorkspace({ ...workspace, layers: { legacyLayer: false } })).toBe(true);
  });

  it.each([null, undefined, false, 1, 'workspace', []])('rejects an unusable payload: %j', value => {
    expect(isPlanetSlamWorkspace(value)).toBe(false);
  });

  const invalidFields: Array<[string, unknown]> = [
    ['preset', 'cyber'], ['preset', null], ['customized', 1], ['view', 'unknown'], ['timeRange', '12h'],
    ['zoom', -0.1], ['zoom', 24.1], ['zoom', NaN], ['zoom', Infinity], ['zoom', '1'],
    ['layers', null], ['layers', []], ['layers', { weather: 1 }], ['layers', { weather: undefined }],
    ['panelRows', null], ['panelRows', []], ['panelRows', { politics: 0 }], ['panelRows', { politics: 5 }],
    ['panelRows', { politics: 1.5 }], ['panelRows', { politics: '2' }],
    ['panelColumns', false], ['panelColumns', []], ['panelColumns', { politics: 0 }],
    ['panelColumns', { politics: 4 }], ['panelColumns', { politics: NaN }],
    ['center', null], ['center', {}], ['center', { lat: 0 }], ['center', { lat: 90.1, lon: 0 }],
    ['center', { lat: 0, lon: -180.1 }], ['center', { lat: NaN, lon: 0 }],
    ['center', { lat: 0, lon: Infinity }], ['center', { lat: '0', lon: 0 }],
  ];

  it.each(invalidFields)('drops invalid dashboard metadata (%s: %j) while retaining its tab', (key, value) => {
    const dashboard = { ...workspace, [key]: value };
    expect(isPlanetSlamWorkspace(dashboard)).toBe(false);
    const tab = { id: 'tab-world-a', name: 'Main', panelSettings: {}, panelOrder: ['politics'], bottomSet: [] };
    expect(normalizeTabsState({ activeTabId: tab.id, tabs: [{ ...tab, dashboard }] }))
      .toEqual({ activeTabId: tab.id, tabs: [tab] });
  });
});
