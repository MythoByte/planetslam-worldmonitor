import { publishEarthSelection } from '@/services/earth';
import type { EarthMapMarker } from '@/types/earth-map';
export function selectEarthMarker(marker: EarthMapMarker): void {
  if (marker.recordedAt) {
    window.dispatchEvent(new CustomEvent('planetslam:earth-history-select', { detail: { id: marker.id, kind: marker.kind } }));
    return;
  }
  publishEarthSelection({ origin: 'map', id: marker.id, kind: marker.kind, latitude: marker.latitude, longitude: marker.longitude });
}
