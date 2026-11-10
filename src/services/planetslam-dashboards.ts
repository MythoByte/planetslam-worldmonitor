import type { MapLayers, PanelConfig } from '@/types';
import { ALL_PANELS, getEffectivePanelConfig } from '@/config/panels';
import { getPlanetSlamDashboard, isPlanetSlamDashboardId, type PlanetSlamDashboardId } from '@/config/planetslam-dashboards';
import type { MissionMapView, MissionTimeRange } from '@/services/mission-presets';

export interface PlanetSlamWorkspace {
  preset: PlanetSlamDashboardId;
  customized: boolean;
  layers: MapLayers;
  view: MissionMapView;
  timeRange: MissionTimeRange;
  zoom: number;
  center?: { lat: number; lon: number };
  panelRows?: Record<string, number>;
  panelColumns?: Record<string, number>;
}

/** Old shared edition URLs remain valid entry points to the matching preset. */
export function requestedPlanetSlamDashboard(search: string): PlanetSlamDashboardId | null {
  const params = new URLSearchParams(search);
  const value = params.get('dashboard') ?? params.get('variant');
  if (value === 'cyber') return 'tech';
  if (value === 'space' || value === 'earth') return 'full';
  return isPlanetSlamDashboardId(value) ? value : null;
}

export function buildPlanetSlamDashboard(
  id: PlanetSlamDashboardId,
  current: Record<string, PanelConfig>,
  defaultLayers: MapLayers,
) {
  const preset = getPlanetSlamDashboard(id);
  const selected = new Set<string>(['map', ...preset.panels]);
  const panelSettings = Object.fromEntries(Object.keys({ ...ALL_PANELS, ...current }).map(key => {
    if (!(key in ALL_PANELS)) return [key, { ...current[key]! }];
    const config = getEffectivePanelConfig(key, id);
    return [key, { ...config, enabled: selected.has(key) && config.premium !== 'locked' }];
  }));
  const layers = Object.fromEntries(Object.keys(defaultLayers).map(key => [key, false])) as unknown as MapLayers;
  for (const key of preset.layers) layers[key] = true;
  return { panelSettings, panelOrder: preset.panels.filter(key => key in ALL_PANELS), layers };
}

export function isPlanetSlamWorkspace(value: unknown): value is PlanetSlamWorkspace {
  if (!value || typeof value !== 'object') return false;
  const s = value as PlanetSlamWorkspace;
  const sizes = (value: unknown, max: number) => value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(span => Number.isInteger(span) && span >= 1 && span <= max));
  return sizes(s.panelRows, 4) && sizes(s.panelColumns, 3) && isPlanetSlamDashboardId(s.preset) && typeof s.customized === 'boolean'
    && ['global', 'america', 'mena', 'eu', 'asia', 'latam', 'africa', 'oceania'].includes(s.view)
    && ['1h', '6h', '24h', '48h', '7d', 'all'].includes(s.timeRange)
    && Number.isFinite(s.zoom) && s.zoom >= 0 && s.zoom <= 24
    && !!s.layers && typeof s.layers === 'object' && !Array.isArray(s.layers)
    && Object.values(s.layers).every(value => typeof value === 'boolean')
    && (s.center === undefined || (!!s.center && Number.isFinite(s.center.lat) && Math.abs(s.center.lat) <= 90 && Number.isFinite(s.center.lon) && Math.abs(s.center.lon) <= 180));
}
