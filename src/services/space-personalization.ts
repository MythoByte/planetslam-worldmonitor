/** Space observing preferences stay in this browser; they are never sent to an API. */
import type { SpaceObserver } from '@/types/space-observing';
import { isStorageAvailable, safeStorageGetChecked, safeStorageSetChecked } from '@/utils/safe-storage';
export type { SpaceObserver } from '@/types/space-observing';
export interface SpacePreferences {
  observer: SpaceObserver | null;
  horizonHours: 24 | 48;
  satelliteWatchlist: string[];
  launchWatchlist: string[];
  missionWatchlist: string[];
}
export type SpaceWatchKind = 'satellite' | 'launch' | 'mission';
const STORAGE_KEY = 'planetslam-space-personalization-v1';
export const SPACE_WATCH_LIMIT = 10;
const listeners = new Set<(preferences: SpacePreferences) => void>();
const watchKey = { satellite: 'satelliteWatchlist', launch: 'launchWatchlist', mission: 'missionWatchlist' } as const;

export function validSpaceObserver(raw: unknown): raw is SpaceObserver {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const observer = raw as SpaceObserver;
  return Number.isFinite(observer.latitude) && observer.latitude >= -90 && observer.latitude <= 90
    && Number.isFinite(observer.longitude) && observer.longitude >= -180 && observer.longitude <= 180
    && Number.isFinite(observer.altitudeM) && observer.altitudeM >= -500 && observer.altitudeM <= 10_000;
}
export function validSpaceWatchId(kind: SpaceWatchKind, value: unknown): value is string {
  return typeof value === 'string' && (kind === 'satellite' ? /^[1-9]\d{0,8}$/ : /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/).test(value);
}
export function normalizeSpacePreferences(raw: unknown): SpacePreferences {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Partial<SpacePreferences> : {};
  const list = (kind: SpaceWatchKind): string[] => {
    const items = value[watchKey[kind]];
    return Array.isArray(items) ? [...new Set(items.filter((id): id is string => validSpaceWatchId(kind, id)))].slice(0, SPACE_WATCH_LIMIT) : [];
  };
  return {
    observer: validSpaceObserver(value.observer) ? { latitude: value.observer.latitude, longitude: value.observer.longitude, altitudeM: value.observer.altitudeM } : null,
    horizonHours: value.horizonHours === 48 ? 48 : 24,
    satelliteWatchlist: list('satellite'), launchWatchlist: list('launch'), missionWatchlist: list('mission'),
  };
}
let fallback = normalizeSpacePreferences(null);
let storageFailed = false;
export function getSpacePreferences(): SpacePreferences {
  if (storageFailed) return normalizeSpacePreferences(fallback);
  const result = safeStorageGetChecked(STORAGE_KEY);
  if (!result.ok) return normalizeSpacePreferences(fallback);
  const saved = result.value;
  try { return saved ? normalizeSpacePreferences(JSON.parse(saved)) : normalizeSpacePreferences(null); }
  catch { return normalizeSpacePreferences(null); }
}
function emit(): void { const preferences = getSpacePreferences(); for (const listener of listeners) listener(preferences); }
function write(preferences: SpacePreferences): void {
  fallback = normalizeSpacePreferences(preferences);
  // Explicit choices remain usable for this page when storage is blocked.
  storageFailed = !isStorageAvailable() || !safeStorageSetChecked(STORAGE_KEY, JSON.stringify(fallback));
  emit();
}
export function setSpaceObserver(observer: SpaceObserver | null): boolean {
  if (observer !== null && !validSpaceObserver(observer)) return false;
  write({ ...getSpacePreferences(), observer }); return true;
}
export function setSpaceHorizon(horizonHours: 24 | 48): void {
  if (horizonHours === 24 || horizonHours === 48) write({ ...getSpacePreferences(), horizonHours });
}
export function isSpaceWatched(kind: SpaceWatchKind, id: string): boolean {
  return getSpacePreferences()[watchKey[kind]].includes(id);
}
/** Returns the resulting watched state. An invalid identifier or full list cannot add an item. */
export function toggleSpaceWatch(kind: SpaceWatchKind, id: string): boolean {
  if (!validSpaceWatchId(kind, id)) return false;
  const preferences = getSpacePreferences(); const key = watchKey[kind];
  if (preferences[key].includes(id)) { write({ ...preferences, [key]: preferences[key].filter(item => item !== id) }); return false; }
  if (preferences[key].length >= SPACE_WATCH_LIMIT) return false;
  write({ ...preferences, [key]: [...preferences[key], id] }); return true;
}
function onStorage(event: StorageEvent): void { if (event.key === STORAGE_KEY || event.key === null) emit(); }
export function subscribeSpacePreferences(listener: (preferences: SpacePreferences) => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage); };
}
