import type { EarthEvent } from './earth';

export interface EarthMapMarker {
  id: string;
  kind: 'event' | 'camera';
  title: string;
  hazard: string;
  mode: string;
  severity: string;
  latitude: number;
  longitude: number;
  recordedAt?: number;
}
export interface EarthMapSnapshot { markers: EarthMapMarker[] }
export const EARTH_MARKER_EVENT = 'planetslam:earth-select';
export function earthMarkerLabel(marker: EarthMapMarker): string {
  return `${marker.recordedAt ? `Historical snapshot ${new Date(marker.recordedAt).toISOString()} · ` : ''}${marker.title} · ${marker.kind === 'camera' ? 'webcam location' : `${marker.hazard} · ${marker.mode} · ${marker.severity}`}`;
}
export function isEarthPosition(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}
export function earthEventMarker(event: EarthEvent): EarthMapMarker | null {
  if (!isEarthPosition(event.latitude, event.longitude)) return null;
  return { id: event.id, kind: 'event', title: event.title, hazard: event.kind, mode: event.mode,
    severity: event.severity, latitude: event.latitude!, longitude: event.longitude! };
}
