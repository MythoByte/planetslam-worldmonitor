import { LAYER_REGISTRY } from '@/config/map-layer-definitions';
import { IS_PLANETSLAM } from '@/config/brand';
import type { MapLayers } from '@/types';

/** Decode the registry's numeric HTML entities for shared SVG artwork selection. */
export function layerMarkerIcon(key: keyof MapLayers): string {
  return LAYER_REGISTRY[key].icon.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) =>
    String.fromCodePoint(code[0]?.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)));
}

export function layerMarkerUrl(icon: string): string {
  if (icon.startsWith('hazard-')) return `/branding/planetslam/layer-icons/${icon}.svg`;
  return `/branding/planetslam/layer-icons/${icon.codePointAt(0)!.toString(16)}.svg`;
}

export function layerMenuIcon(iconHtml: string): string {
  if (!IS_PLANETSLAM) return iconHtml;
  const icon = iconHtml.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
  return `<img class="planetslam-menu-icon" src="${layerMarkerUrl(icon)}" alt="" width="16" height="16">`;
}

const HAZARD_ICONS: readonly [RegExp, string][] = [
  [/earthquake|seismic/, 'earthquake'], [/tsunami/, 'tsunami'],
  [/flood/, 'flood'], [/volcan/, 'volcano'], [/wildfire|wild fire|fire/, 'wildfire'],
  [/tornado|waterspout/, 'tornado'], [/avalanche/, 'avalanche'],
  [/landslide|mudslide|debris flow/, 'landslide'], [/drought/, 'drought'],
  [/heat|hot|temp extremes/, 'heat'], [/hail/, 'hail'],
  [/snow|winter|blizzard|\bice\b|icing|freez|frost|cold/, 'winter'],
  [/lightning|thunder/, 'lightning'], [/dust|haze|fog|smoke/, 'fog'],
  [/coastal|surf|marine|water color/, 'coastal'],
  [/storm|hurricane|cyclone|typhoon|wind/, 'storm'],
];

/** Shared by Earth snapshots, native events and weather alerts in all renderers. */
export function hazardMarkerIcon(hazard: string): string {
  const value = hazard.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const match = HAZARD_ICONS.find(([pattern]) => pattern.test(value));
  return match ? `hazard-${match[1]}` : layerMarkerIcon(value === 'other' || value === 'manmade' ? 'natural' : 'weather');
}

export function earthMarkerIcon(marker: { kind: string; hazard?: string }): string {
  return marker.kind === 'camera' ? layerMarkerIcon('webcams') : hazardMarkerIcon(marker.hazard ?? 'other');
}

/** Replace only the visual glyph; keep the marker's listeners, labels and badges. */
export function paintLayerMarker(element: HTMLElement, icon: string): void {
  if (!IS_PLANETSLAM) return;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) child.remove();
  }
  element.dataset.layerIcon = icon;
  element.classList.add('planetslam-layer-marker');
  const glyph = document.createElement('img');
  glyph.className = 'planetslam-layer-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.src = layerMarkerUrl(icon);
  glyph.alt = '';
  glyph.width = glyph.height = 22;
  element.prepend(glyph);
}

export const SVG_MARKER_LAYERS: Record<string, keyof MapLayers> = {
  hotspot: 'hotspots', 'tech-activity-marker': 'hotspots', 'geo-activity-marker': 'hotspots', 'base-marker': 'bases', 'nuclear-marker': 'nuclear',
  'irradiator-marker': 'irradiators', 'earthquake-marker': 'natural', 'nat-event-marker': 'natural',
  'economic-marker': 'economic', 'weather-marker': 'weather', 'outage-marker': 'outages',
  'radiation-watch-marker': 'radiationWatch', 'cable-advisory-marker': 'cables', 'repair-ship-marker': 'cables',
  'datacenter-marker': 'datacenters', 'spaceport-marker': 'spaceports', 'mineral-marker': 'minerals',
  'startup-hub-marker': 'startupHubs', 'cloud-region-marker': 'cloudRegions', 'tech-hq-marker': 'techHQs',
  'accelerator-marker': 'accelerators', 'tech-event-marker': 'techEvents', 'exchange-marker': 'stockExchanges',
  'financial-center-marker': 'financialCenters', 'central-bank-marker': 'centralBanks', 'commodity-hub-marker': 'commodityHubs',
  'protest-marker': 'protests', 'flight-delay-marker': 'flights', 'aircraft-marker': 'flights',
  'military-flight-marker': 'military', 'military-vessel-marker': 'military', 'military-cluster-marker': 'military',
  'aircraft-emergency-marker': 'aircraftEmergencies', 'fire-dot': 'fires', 'webcam-dot': 'webcams',
  'conflict-event-marker': 'conflicts', 'iran-event-marker': 'iranAttacks', 'waterway-marker': 'waterways',
  'ais-disruption-marker': 'ais', 'port-marker': 'ais', 'apt-marker': 'cyberThreats',
  'cross-border-marker': 'displacement',
};

export const GLOBE_MARKER_LAYERS: Record<string, keyof MapLayers> = {
  conflict: 'conflicts', conflictZone: 'conflicts', hotspot: 'hotspots', flight: 'military', vessel: 'military',
  cluster: 'military', weather: 'weather', natural: 'natural', iran: 'iranAttacks', outage: 'outages',
  trafficAnomaly: 'outages', ddosHit: 'outages', cyber: 'cyberThreats', fire: 'fires', protest: 'protests',
  ucdp: 'ucdpEvents', displacement: 'displacement', crossBorder: 'displacement', climate: 'climate',
  gpsjam: 'gpsJamming', tech: 'techEvents', milbase: 'bases', nuclearSite: 'nuclear', irradiator: 'irradiators',
  spaceport: 'spaceports', earthquake: 'natural', radiation: 'radiationWatch', economic: 'economic',
  datacenter: 'datacenters', waterway: 'waterways', mineral: 'minerals', flightDelay: 'flights',
  cableAdvisory: 'cables', repairShip: 'cables', aisDisruption: 'ais', ukmtoIncident: 'ais',
  satellite: 'satellites', satFootprint: 'satellites', imageryScene: 'satellites', webcam: 'webcams', 'webcam-cluster': 'webcams',
};
