import { ScatterplotLayer } from '@deck.gl/layers';
import type { EarthMapMarker, EarthMapSnapshot } from '@/types/earth-map';
import { selectEarthMarker } from './earth-map-interaction';
export function earthMarkerColor(marker: EarthMapMarker): [number, number, number, number] {
  if (marker.kind === 'camera') return [78, 213, 200, 230];
  if (marker.mode === 'warning') return [255, 108, 108, 235];
  if (marker.mode === 'forecast') return [188, 151, 255, 230];
  return [255, 189, 91, 230];
}
export function createEarthMapLayers(snapshot: EarthMapSnapshot | null): ScatterplotLayer<EarthMapMarker>[] {
  if (!snapshot?.markers.length) return [];
  return [new ScatterplotLayer<EarthMapMarker>({
    id: 'earth-events-and-cameras', data: snapshot.markers,
    getPosition: marker => [marker.longitude, marker.latitude], getRadius: 10000,
    getFillColor: earthMarkerColor, stroked: true, getLineColor: [245, 245, 250, 235],
    lineWidthMinPixels: 1, radiusMinPixels: 5, radiusMaxPixels: 13, pickable: true,
    onClick: info => { if (info.object) selectEarthMarker(info.object); return true; },
  })];
}
