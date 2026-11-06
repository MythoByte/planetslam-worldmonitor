import type { SatRec } from 'satellite.js';
import type { OrbitGroupId, OrbitObject } from './space';

export interface PreparedSpaceOrbit { item: OrbitObject; epoch: number; satrec: SatRec; sourceGroups: { id: OrbitGroupId; expiresAt: number; fetchedAt?: number; refreshFailed?: boolean }[] }
export interface SpaceOrbitPosition {
  noradId: string;
  name: string;
  longitude: number;
  latitude: number;
  altitudeKm: number;
  velocityKmS: number;
  inclinationDeg: number;
  periodMinutes: number;
  epoch: number;
  elementStatus: 'fresh' | 'stale';
  selected: boolean;
}
export interface SpaceGroundTrack {
  phase: 'past' | 'future';
  /** Geographic longitude, latitude, altitude in kilometres. Each segment is dateline-safe. */
  points: [number, number, number][];
}
export interface SpaceOrbitSnapshot {
  calculatedAt: number;
  selectedId: string;
  selected: SpaceOrbitPosition | null;
  positions: SpaceOrbitPosition[];
  groundTracks: SpaceGroundTrack[];
  shownCount: number;
  totalCount: number;
  expiredCount: number;
}
export interface SpaceOrbitOptions { selectedId: string; group: OrbitGroupId; now?: Date; includeGroup?: boolean }
