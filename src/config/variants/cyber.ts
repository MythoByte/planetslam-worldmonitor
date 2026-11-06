import type { PanelConfig, MapLayers } from '@/types';
import { DEFAULT_MAP_LAYERS as SPACE_LAYERS } from './space';

export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Context Map', enabled: false, priority: 3 },
  'cyber-news': { name: 'Cyber News', enabled: true, priority: 1 },
  'cyber-kev': { name: 'Exploited Vulnerabilities', enabled: true, priority: 1 },
  'cyber-watchlist': { name: 'My Technology Watchlist', enabled: true, priority: 1 },
  'cyber-health': { name: 'Cyber Data Status', enabled: true, priority: 2 },
};
// Phase 1 has no map panel or attack telemetry. Preserve the common layer shape.
export const DEFAULT_MAP_LAYERS = Object.fromEntries(Object.keys(SPACE_LAYERS).map(key => [key, false])) as unknown as MapLayers;
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = { ...DEFAULT_MAP_LAYERS };
