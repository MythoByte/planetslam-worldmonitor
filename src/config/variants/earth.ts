import type { PanelConfig, MapLayers } from '@/types';
import { DEFAULT_MAP_LAYERS as SPACE_LAYERS } from './space';

export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Earth — Weather & Natural Hazards', enabled: true, priority: 1 },
  'earth-watch': { name: 'My Earth', enabled: true, priority: 1 },
  'earth-events': { name: 'Active Earth Events', enabled: true, priority: 1 },
  'earth-alerts': { name: 'Official Alerts', enabled: true, priority: 1 },
  'earth-weather': { name: 'Weather & Forecasts', enabled: true, priority: 1 },
  'earth-news': { name: 'Earth News', enabled: true, priority: 1 },
  'earth-cameras': { name: 'Earth Webcams', enabled: true, priority: 1 },
  'earth-rivers': { name: 'River Levels', enabled: true, priority: 2 },
  'earth-airquality': { name: 'Air Quality & Smoke', enabled: true, priority: 2 },
  'earth-health': { name: 'Earth Data Status', enabled: true, priority: 2 },
};
// Dedicated Earth controls own hazard and camera layers. The shared weather
// toggle enables radar on the desktop flat map; other renderers show events.
export const DEFAULT_MAP_LAYERS = {
  ...Object.fromEntries(Object.keys(SPACE_LAYERS).map(key => [key, false])),
  weather: true,
  dayNight: true,
} as unknown as MapLayers;
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = { ...DEFAULT_MAP_LAYERS, weather: false };
