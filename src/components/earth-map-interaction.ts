import { publishEarthSelection } from '@/services/earth';
import type { EarthMapMarker } from '@/types/earth-map';
export function selectEarthMarker(marker: EarthMapMarker): void {
  publishEarthSelection({ origin: 'map', id: marker.id, kind: marker.kind, latitude: marker.latitude, longitude: marker.longitude });
}
