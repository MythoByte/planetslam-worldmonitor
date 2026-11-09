// PlanetSlam Space edition. Shared by the runtime registry and focused tests.
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Space & Orbit Map', enabled: true, priority: 1 },
  'space-brief': { name: 'Space Daily Brief', enabled: true, priority: 1 },
  'space-satellites': { name: 'Satellite Tracker', enabled: true, priority: 1 },
  'space-observing': { name: 'Tonight’s Sky & Observing', enabled: true, priority: 1 },
  'space-cameras': { name: 'Space Live', enabled: true, priority: 1 },
  'space-launches': { name: 'Launch Countdown', enabled: true, priority: 1 },
  'space-missions': { name: 'Mission Events', enabled: true, priority: 1 },
  'space-weather': { name: 'Space Weather', enabled: true, priority: 1 },
  'space-apod': { name: 'Astronomy Picture of the Day', enabled: true, priority: 1 },
  'space-news': { name: 'Space News', enabled: true, priority: 1 },
  'space-spacex': { name: 'SpaceX Watch', enabled: true, priority: 1 },
  'space-neo': { name: 'Near-Earth Objects', enabled: true, priority: 2 },
  'space-solar': { name: 'Sun Now', enabled: true, priority: 2 },
  'space-events': { name: 'Solar Event History', enabled: true, priority: 2 },
  'space-health': { name: 'Space Data Status', enabled: true, priority: 3 },
};

// Shared Global catalog: keep the existing map and any existing panel IDs.
export const GLOBAL_SPACE_PANELS = Object.fromEntries(
  Object.entries(DEFAULT_PANELS).filter(([key]) => key !== 'map'),
);

export const SPACE_PANEL_ICONS: Record<string, string> = Object.fromEntries(
  Object.keys(GLOBAL_SPACE_PANELS).map(key => [key, `/branding/planetslam/space-icons/${key.slice(6)}.svg`]),
);

export const DEFAULT_MAP_LAYERS: MapLayers = {
  aircraftEmergencies: false,
  iranAttacks: false,
  gpsJamming: false,
  satellites: true,
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  storageFacilities: false,
  fuelShortages: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  radiationWatch: false,
  sanctions: false,
  weather: false,
  canadaRoads: false,
  canadaAlerts: false,
  economic: false,
  waterways: false,
  outages: false,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: false,
  spaceports: true,
  minerals: false,
  fires: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
  ciiChoropleth: false,
  resilienceScore: false,
  dayNight: true,
  miningSites: false,
  processingPlants: false,
  commodityPorts: false,
  webcams: true,
  diseaseOutbreaks: false,
};

// Keep the same small selection on mobile; the renderer capability filter
// omits layers that cannot paint on a user's active renderer.
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = { ...DEFAULT_MAP_LAYERS };

export const VARIANT_CONFIG: VariantConfig = {
  name: 'space',
  description: 'Space cameras, launches, astronomy, solar weather, and near-Earth objects',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
