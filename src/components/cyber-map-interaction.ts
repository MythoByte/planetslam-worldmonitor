import type { CyberMapMarker } from '@/types/cyber-map';
export const CYBER_MARKER_EVENT = 'planetslam:cyber-marker';
export function selectCyberMarker(marker: CyberMapMarker): void {
  window.dispatchEvent(new CustomEvent(CYBER_MARKER_EVENT, { detail: { id: marker.id, kind: marker.kind } }));
}
