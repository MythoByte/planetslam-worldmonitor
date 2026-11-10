import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { IS_PLANETSLAM } from '@/config/brand';
import type { MapLayers } from '@/types';
import { earthMarkerIcon, hazardMarkerIcon, platformMarkerIcon, markerHeading, layerMarkerIcon, layerMarkerUrl } from './map-layer-icons';

const MARKER_LAYERS: Record<string, keyof MapLayers> = {
  'commercial-shipping-layer': 'commercialShipping',
  'gdelt-attack-reports': 'attackReports',
  'bases-layer': 'bases',
  'bases-cluster-layer': 'bases',
  'nuclear-layer': 'nuclear',
  'irradiators-layer': 'irradiators',
  'spaceports-layer': 'spaceports',
  'ports-layer': 'ais',
  'flight-delays-layer': 'flights',
  'aircraft-positions-layer': 'flights',
  'datacenters-layer': 'datacenters',
  'earthquakes-layer': 'natural',
  'natural-events-layer': 'natural',
  'storm-centers-layer': 'natural',
  'fires-layer': 'fires',
  'iran-events-layer': 'iranAttacks',
  'canada-roads-layer': 'canadaRoads',
  'canada-alerts-layer': 'canadaAlerts',
  'weather-layer': 'weather',
  'outages-layer': 'outages',
  'traffic-anomalies-layer': 'outages',
  'ddos-locations-layer': 'outages',
  'cyber-threats-layer': 'cyberThreats',
  'radiation-watch-layer': 'radiationWatch',
  'disease-outbreaks-layer': 'diseaseOutbreaks',
  'live-tankers-layer': 'liveTankers',
  'ais-disruptions-layer': 'ais',
  'cable-advisories-layer': 'cables',
  'repair-ships-layer': 'cables',
  'military-vessels-layer': 'military',
  'military-vessel-clusters-layer': 'military',
  'military-flights-layer': 'military',
  'military-flight-clusters-layer': 'military',
  'waterways-layer': 'waterways',
  'economic-centers-layer': 'economic',
  'stock-exchanges-layer': 'stockExchanges',
  'financial-centers-layer': 'financialCenters',
  'central-banks-layer': 'centralBanks',
  'commodity-hubs-layer': 'commodityHubs',
  'apt-groups-layer': 'cyberThreats',
  'minerals-layer': 'minerals',
  'mining-sites-layer': 'miningSites',
  'processing-plants-layer': 'processingPlants',
  'commodity-ports-layer': 'commodityPorts',
  'startup-hubs-layer': 'startupHubs',
  'accelerators-layer': 'accelerators',
  'cloud-regions-layer': 'cloudRegions',
  'protest-clusters-layer': 'protests',
  'tech-hq-clusters-layer': 'techHQs',
  'tech-event-clusters-layer': 'techEvents',
  'datacenter-clusters-layer': 'datacenters',
  'hotspots-layer': 'hotspots',
  'gulf-investments-layer': 'gulfInvestments',
  'positive-events-layer': 'positiveEvents',
  'kindness-layer': 'kindness',
  'species-recovery-layer': 'speciesRecovery',
  'renewable-installations-layer': 'renewableInstallations',
  'ucdp-events-layer': 'ucdpEvents',
  'cross-border-points-layer': 'displacement',
  'cross-border-deaths-layer': 'displacement',
  'displacement-events-layer': 'displacement',
  'internal-displacement-regions-layer': 'displacement',
  'trade-chokepoints-layer': 'tradeRoutes',
  'storage-facilities-layer': 'storageFacilities',
  'fuel-shortages-layer': 'fuelShortages',
  'ukmto-incidents-layer': 'ais',
  'webcam-layer': 'webcams',
  'space-upcoming-launches': 'spaceports',
  'space-orbit-positions': 'satellites',
  'aircraft-emergencies': 'aircraftEmergencies',
  'notam-overlay-layer': 'flights',
};
const icons = new Map<string, { url: string; width: number; height: number; mask: boolean }>();
function markerArtwork(icon: string) {
  let result = icons.get(icon);
  if (!result) {
    result = { url: layerMarkerUrl(icon), width: 64, height: 64, mask: false };
    icons.set(icon, result);
  }
  return result;
}

/** Preserve IDs, objects and interaction callbacks used by the map's picking dispatcher. */
export function withLayerIcons(layer: Layer): Layer {
  if (!IS_PLANETSLAM || !(layer instanceof ScatterplotLayer || layer instanceof IconLayer)) return layer;
  const key = MARKER_LAYERS[layer.id];
  const earth = layer.id === 'earth-events-and-cameras';
  const cyber = layer.id.startsWith('cyber-native-');
  const news = layer.id === 'news-locations-layer';
  if (!key && !earth && !cyber && !news) return layer;
  const aircraft = ['military-flights-layer', 'military-flight-clusters-layer', 'aircraft-positions-layer', 'aircraft-emergencies'].includes(layer.id);
  const vessel = ['military-vessels-layer', 'military-vessel-clusters-layer', 'repair-ships-layer', 'live-tankers-layer'].includes(layer.id);
  const { data, getPosition, pickable, onClick, onHover, visible, opacity, parameters, updateTriggers } = layer.props;
  return new IconLayer({
    id: layer.id, data, getPosition, pickable, onClick, onHover, visible, opacity, parameters,
    getIcon: aircraft || vessel
      ? (object: { aircraftType?: string; vesselType?: string }) => markerArtwork(platformMarkerIcon(aircraft ? 'aircraft' : 'vessel',
        layer.id === 'aircraft-emergencies' ? 'emergency' : layer.id === 'repair-ships-layer' ? 'repair'
          : layer.id === 'live-tankers-layer' ? 'auxiliary' : aircraft ? object.aircraftType : object.vesselType))
      : earth ? (marker: { kind: string; hazard?: string }) => markerArtwork(earthMarkerIcon(marker))
      : ['earthquakes-layer', 'natural-events-layer', 'storm-centers-layer', 'weather-layer'].includes(layer.id)
        ? (event: { category?: string; event?: string; headline?: string }) => markerArtwork(hazardMarkerIcon(
          layer.id === 'earthquakes-layer' ? 'earthquake' : event.category || event.event || event.headline || 'weather'))
      : () => markerArtwork(news ? '📰' : layerMarkerIcon(key ?? 'cyberThreats')),
    // IconLayer angles are counter-clockwise; tracking headings are clockwise from north.
    getAngle: aircraft || vessel ? (object: { heading?: number; trackDeg?: number }) => -markerHeading(object.heading ?? object.trackDeg) : 0,
    getSize: 24, sizeUnits: 'pixels', billboard: true,
    updateTriggers: { getPosition: updateTriggers?.getPosition },
  });
}
