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

function hasValidPanelSpans(value: unknown, max: number): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(span => Number.isInteger(span) && span >= 1 && span <= max);
}

export function isPlanetSlamWorkspace(value: unknown): value is PlanetSlamWorkspace {
  if (!value || typeof value !== 'object') return false;
  const workspace = value as PlanetSlamWorkspace;

  if (!hasValidPanelSpans(workspace.panelRows, 4) || !hasValidPanelSpans(workspace.panelColumns, 3)) return false;
  if (!isPlanetSlamDashboardId(workspace.preset) || typeof workspace.customized !== 'boolean') return false;
  if (!['global', 'america', 'mena', 'eu', 'asia', 'latam', 'africa', 'oceania'].includes(workspace.view)) return false;
  if (!['1h', '6h', '24h', '48h', '7d', 'all'].includes(workspace.timeRange)) return false;
  if (!Number.isFinite(workspace.zoom) || workspace.zoom < 0 || workspace.zoom > 24) return false;

  const { layers, center } = workspace;
  if (!layers || typeof layers !== 'object' || Array.isArray(layers)) return false;
  if (!Object.values(layers).every(enabled => typeof enabled === 'boolean')) return false;

  if (center === undefined) return true;
  return !!center
    && Number.isFinite(center.lat) && Math.abs(center.lat) <= 90
    && Number.isFinite(center.lon) && Math.abs(center.lon) <= 180;
}
