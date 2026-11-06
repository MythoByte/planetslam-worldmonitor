import type { PreparedSpaceOrbit } from './space-orbits';

export interface SpaceObserver { latitude: number; longitude: number; altitudeM: number }
export interface SolarPosition { at: number; rightAscensionDeg: number; declinationDeg: number; eclipticLongitudeDeg: number; distanceAu: number; vectorKm: { x: number; y: number; z: number } }
export interface MoonPhase { at: number; phaseFraction: number; illumination: number; phaseName: string; approximateAgeDays: number; waxing: boolean; model: 'approximate' }
export interface SpaceVisibilityWindow { startAt: number; endAt: number; maxElevationDeg: number }
export interface SpaceSatellitePass {
  noradId: string;
  name: string;
  aosAt: number;
  peakAt: number;
  losAt: number;
  maxElevationDeg: number;
  aosAzimuthDeg: number;
  peakAzimuthDeg: number;
  losAzimuthDeg: number;
  aosDirection: string;
  peakDirection: string;
  losDirection: string;
  ongoing: boolean;
  endsAfterWindow: boolean;
  visible: boolean;
  visibleWindows: SpaceVisibilityWindow[];
  visibleAtPeak: boolean;
  observerSunElevationAtPeakDeg: number;
  satelliteSunlitAtPeak: boolean;
  sourceStatus: 'fresh' | 'stale' | 'unavailable';
  sourceExpiresAt: number;
  elementEpoch: number;
  elementStatus: 'fresh' | 'stale';
}
export interface SpaceSatellitePrediction {
  noradId: string;
  name: string;
  status: 'predicted' | 'no-passes' | 'unavailable' | 'expired';
  sourceStatus: 'fresh' | 'stale' | 'unavailable';
  elementEpoch: number | null;
  elementStatus: 'fresh' | 'stale' | null;
  sourceExpiresAt: number | null;
  message?: string;
  passes: SpaceSatellitePass[];
}
export interface SpacePassPrediction {
  generatedAt: number;
  windowStart: number;
  windowEnd: number;
  observer: SpaceObserver;
  passes: SpaceSatellitePass[];
  satellites: SpaceSatellitePrediction[];
  requestedCount: number;
  processedCount: number;
  truncated: boolean;
}
export interface SpacePassOptions {
  observer: SpaceObserver;
  ids: string[];
  horizonHours?: 24 | 48;
  now?: Date;
  minPeakElevationDeg?: number;
  signal?: AbortSignal;
}
export type SpacePreparedPassOrbits = PreparedSpaceOrbit[];
