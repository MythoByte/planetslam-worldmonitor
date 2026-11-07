import type { EarthEvent, EarthHazard, EarthSeverity, EarthSource } from './earth';

export interface EarthSavedLocation { id: string; name: string; latitude: number; longitude: number }
export interface EarthWatchPreferences {
  locations: EarthSavedLocation[]; selectedLocationId: string | null; radiusKm: number;
  minSeverity: Exclude<EarthSeverity, 'unknown'> | 'all'; includeUnknown: boolean;
  minMagnitude: number; hazards: EarthHazard[]; alertsEnabled: boolean;
}
export interface EarthWatchMatch { event: EarthEvent; distanceKm: number }
export type EarthWatchChangeType = 'new' | 'escalated' | 'updated' | 'expired' | 'cancelled' | 'closed' | 'recovered' | 'missing';
export interface EarthWatchChange {
  id: string; type: EarthWatchChangeType; title: string; event: EarthEvent;
  at: number; locationId: string; read: boolean;
}
export interface EarthWatchRecord {
  key: string; event: EarthEvent; version: string; aliases: string[];
  notificationVersion: string | null; notificationSeverity: EarthSeverity;
  firstSeenAt: number; lastSeenAt: number; missing: boolean; expired: boolean;
}
export interface EarthWatchState {
  version: 1; scope: string; initializedAt: number; updatedAt: number;
  records: EarthWatchRecord[]; inbox: EarthWatchChange[]; seenChanges: string[];
}
export interface EarthWatchSnapshot { events: EarthEvent[]; sources: EarthSource[]; fetchedAt: number | null }
export interface EarthWatchEvaluation {
  state: EarthWatchState; matches: EarthWatchMatch[]; changes: EarthWatchChange[]; baseline: boolean; unlocated: number;
}
export interface EarthDailyBrief {
  date: string; generatedAt: number; windowStart: number; location: EarthSavedLocation;
  total: number; counts: Partial<Record<EarthHazard, number>>; items: EarthWatchMatch[];
  sources: EarthSource[]; unlocated: number; coverage: string;
}
