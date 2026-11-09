import type { PanelConfig, MapLayers } from '@/types';
import { DEFAULT_MAP_LAYERS as SPACE_LAYERS } from './space';

export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Cyber Incidents & Infrastructure', enabled: true, priority: 1 },
  'cyber-environment': { name: 'My Environment', enabled: true, priority: 1 },
  'cyber-research': { name: 'Cyber Research Workbench', enabled: true, priority: 1 },
  'cyber-alerts': { name: 'Cyber Alerts & Digests', enabled: true, priority: 1 },
  'cyber-brief': { name: 'Cyber Daily Brief', enabled: true, priority: 1 },
  'cyber-attention': { name: 'Vulnerability Attention Queue', enabled: true, priority: 1 },
  'cyber-incidents': { name: 'Reported Cyber Incidents', enabled: true, priority: 1 },
  'cyber-news': { name: 'Cyber News', enabled: true, priority: 1 },
  'cyber-kev': { name: 'Exploited Vulnerabilities', enabled: true, priority: 1 },
  'cyber-watchlist': { name: 'My Technology Watchlist', enabled: true, priority: 1 },
  'cyber-health': { name: 'Cyber Data Status', enabled: true, priority: 2 },
};
// The dedicated Cyber overlay controls its two independently filtered layers.
export const DEFAULT_MAP_LAYERS = Object.fromEntries(Object.keys(SPACE_LAYERS).map(key => [key, false])) as unknown as MapLayers;
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = { ...DEFAULT_MAP_LAYERS };

/** Cyber news joins Tech's existing security panel; its map uses Tech's map. */
export const TECH_CYBER_PANELS = Object.fromEntries(
  Object.entries(DEFAULT_PANELS).filter(([key]) => key !== 'map' && key !== 'cyber-news'),
);
