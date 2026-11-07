import { EARTH_HAZARDS, type EarthEvent, type EarthHazard, type EarthSource } from '@/types/earth';
import type { EarthDailyBrief, EarthSavedLocation, EarthWatchChange, EarthWatchChangeType, EarthWatchEvaluation, EarthWatchMatch, EarthWatchPreferences, EarthWatchRecord, EarthWatchSnapshot, EarthWatchState } from '@/types/earth-watch';
import { safeStorageGetChecked, safeStorageSetChecked } from '@/utils/safe-storage';
export type { EarthDailyBrief, EarthSavedLocation, EarthWatchChange, EarthWatchChangeType, EarthWatchEvaluation, EarthWatchMatch, EarthWatchPreferences, EarthWatchSnapshot, EarthWatchState } from '@/types/earth-watch';

const DAY = 86400_000;
const readStored = (key: string): unknown => { try { const result = safeStorageGetChecked(key); return result.ok && result.value ? JSON.parse(result.value) : null; } catch { return null; } };
const writeStored = (key: string, value: unknown): boolean => { const encoded = JSON.stringify(value); return safeStorageSetChecked(key, encoded) && safeStorageGetChecked(key).value === encoded; };
const PREFS_KEY = 'planetslam-earth-watch-preferences-v1';
const STATE_KEY = 'planetslam-earth-watch-state-v1';
const RANK = { unknown: -1, minor: 0, moderate: 1, severe: 2, extreme: 3 };
const CHANGE_TYPES: EarthWatchChangeType[] = ['new', 'escalated', 'updated', 'expired', 'cancelled', 'closed', 'recovered', 'missing'];
export const DEFAULT_EARTH_WATCH_PREFERENCES: EarthWatchPreferences = {
  locations: [], selectedLocationId: null, radiusKm: 250, minSeverity: 'all', includeUnknown: true,
  minMagnitude: 2.5, hazards: [...EARTH_HAZARDS], alertsEnabled: true,
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const string = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const url = (value: unknown): value is string => { try { const u = new URL(String(value)); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
const position = (latitude: unknown, longitude: unknown): boolean => finite(latitude, -90, 90) && finite(longitude, -180, 180);
const cloneDefaults = (): EarthWatchPreferences => ({ ...DEFAULT_EARTH_WATCH_PREFERENCES, locations: [], hazards: [...EARTH_HAZARDS] });

export function parseEarthWatchPreferences(raw: unknown): EarthWatchPreferences {
  const defaults = cloneDefaults();
  if (!object(raw)) return defaults;
  const locations: EarthSavedLocation[] = [];
  if (Array.isArray(raw.locations)) for (const value of raw.locations.slice(0, 100)) {
    if (!object(value) || !string(value.id, 100) || !string(value.name, 80) || !value.name.trim() || !position(value.latitude, value.longitude) || locations.some(location => location.id === value.id)) continue;
    locations.push({ id: value.id, name: value.name.trim(), latitude: value.latitude as number, longitude: value.longitude as number });
    if (locations.length === 10) break;
  }
  const selectedLocationId = typeof raw.selectedLocationId === 'string' && locations.some(location => location.id === raw.selectedLocationId) ? raw.selectedLocationId : locations[0]?.id ?? null;
  return { locations, selectedLocationId,
    radiusKm: finite(raw.radiusKm, 10, 2000) ? raw.radiusKm : defaults.radiusKm,
    minSeverity: ['all', 'minor', 'moderate', 'severe', 'extreme'].includes(String(raw.minSeverity)) ? raw.minSeverity as EarthWatchPreferences['minSeverity'] : defaults.minSeverity,
    includeUnknown: typeof raw.includeUnknown === 'boolean' ? raw.includeUnknown : defaults.includeUnknown,
    minMagnitude: finite(raw.minMagnitude, 0, 9) ? raw.minMagnitude : defaults.minMagnitude,
    hazards: Array.isArray(raw.hazards) ? [...new Set(raw.hazards.filter((kind): kind is EarthHazard => EARTH_HAZARDS.includes(kind as EarthHazard)))] : [...EARTH_HAZARDS],
    alertsEnabled: typeof raw.alertsEnabled === 'boolean' ? raw.alertsEnabled : defaults.alertsEnabled };
}
export function loadEarthWatchPreferences(): EarthWatchPreferences { return parseEarthWatchPreferences(readStored(PREFS_KEY)); }
export function saveEarthWatchPreferences(preferences: EarthWatchPreferences): boolean { return writeStored(PREFS_KEY, parseEarthWatchPreferences(preferences)); }

export function earthWatchDistanceKm(latitude: number, longitude: number, otherLatitude: number, otherLongitude: number): number {
  if (!position(latitude, longitude) || !position(otherLatitude, otherLongitude)) return Infinity;
  const rad = Math.PI / 180;
  const a = Math.sin((otherLatitude - latitude) * rad / 2) ** 2 + Math.cos(latitude * rad) * Math.cos(otherLatitude * rad) * Math.sin((otherLongitude - longitude) * rad / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}
const recoveryReported = (event: EarthEvent): boolean => /^(?:recovered|contained)(?: by (?:the )?provider)?[.!]?$/i.test(event.status.trim());
const terminal = (event: EarthEvent): boolean => !!event.lifecycle || /^(?:cancelled|canceled|closed)\b/i.test(event.status.trim()) || recoveryReported(event);
const eventKey = (event: EarthEvent): string => `${event.sourceId}|${event.id}`;
const version = (event: EarthEvent): string => hash(JSON.stringify([event.id, event.kind, event.hazards, event.observedAt, event.expiresAt, event.severity, event.status, event.mode, event.title, event.summary, event.latitude, event.longitude, event.magnitude, event.lifecycle]));
const compact = (event: EarthEvent): EarthEvent => ({ ...event, title: event.title.slice(0, 500), summary: String(event.summary || '').slice(0, 600), supersedes: event.supersedes?.slice(0, 30) });
const hash = (value: string): string => { let h = 2166136261, j = 5381; for (let i = 0; i < value.length; i++) { h = Math.imul(h ^ value.charCodeAt(i), 16777619); j = Math.imul(j, 33) ^ value.charCodeAt(i); } return `${(h >>> 0).toString(36)}-${(j >>> 0).toString(36)}`; };
const unique = (events: EarthEvent[]): EarthEvent[] => {
  const byId = new Map<string, EarthEvent>();
  for (const event of events) {
    const key = eventKey(event), previous = byId.get(key);
    if (!previous || previous.observedAt < event.observedAt) byId.set(key, event);
  }
  const values = [...byId.values()];
  const superseded = new Set(values.filter(event => !terminal(event)).flatMap(event => event.supersedes || []));
  const ended = new Map<string, number>();
  for (const event of values.filter(terminal)) for (const id of [event.id, ...(event.supersedes || [])]) ended.set(id, Math.max(ended.get(id) || 0, event.observedAt));
  return values.filter(event => !superseded.has(event.id) && (terminal(event) || (ended.get(event.id) ?? -Infinity) < event.observedAt));
};
function hasHazard(event: EarthEvent, preferences: EarthWatchPreferences): boolean {
  return preferences.hazards.includes(event.kind) || !!event.hazards?.some(hazard => preferences.hazards.includes(hazard));
}
function eligible(event: EarthEvent, preferences: EarthWatchPreferences, now: number): boolean {
  return !terminal(event) && (event.expiresAt === null || event.expiresAt > now) && event.observedAt <= now + 60_000
    && hasHazard(event, preferences)
    && (event.severity === 'unknown' ? preferences.includeUnknown : preferences.minSeverity === 'all' || RANK[event.severity] >= RANK[preferences.minSeverity])
    && (event.kind !== 'earthquake' || typeof event.magnitude === 'number' && event.magnitude >= preferences.minMagnitude);
}
export function getEarthWatchMatches(events: EarthEvent[], location: EarthSavedLocation, preferences: EarthWatchPreferences, now = Date.now()): { matches: EarthWatchMatch[]; unlocated: number } {
  const values = unique(events).filter(event => eligible(event, preferences, now));
  const unlocated = values.filter(event => !position(event.latitude, event.longitude)).length;
  const matches = values.flatMap(event => {
    const distanceKm = earthWatchDistanceKm(location.latitude, location.longitude, event.latitude!, event.longitude!);
    return distanceKm <= preferences.radiusKm ? [{ event, distanceKm }] : [];
  }).sort((a, b) => RANK[b.event.severity] - RANK[a.event.severity] || a.distanceKm - b.distanceKm || b.event.observedAt - a.event.observedAt);
  return { matches, unlocated };
}
const sourceAvailable = (source: EarthSource | undefined, now: number): boolean => !!source && source.status !== 'unavailable' && (source.expiresAt == null || source.expiresAt > now);
const sourceFresh = (source: EarthSource | undefined, now: number): boolean => sourceAvailable(source, now) && source?.status === 'fresh' && (source.staleAt == null || source.staleAt > now);
function freshSources(sources: EarthSource[], now: number): EarthSource[] {
  return sources.map(source => !sourceAvailable(source, now) ? { ...source, status: 'unavailable' } : source.status === 'fresh' && source.staleAt != null && source.staleAt <= now ? { ...source, status: 'stale' } : source);
}
function scope(preferences: EarthWatchPreferences): string {
  return JSON.stringify([preferences.selectedLocationId, preferences.locations.find(location => location.id === preferences.selectedLocationId), preferences.radiusKm, preferences.minSeverity, preferences.includeUnknown, preferences.minMagnitude, [...preferences.hazards].sort(), preferences.alertsEnabled]);
}
export function emptyEarthWatchState(now = Date.now()): EarthWatchState { return { version: 1, scope: '', initializedAt: now, updatedAt: now, records: [], inbox: [], seenChanges: [] }; }
function validEvent(value: unknown): value is EarthEvent {
  if (!object(value)) return false;
  return string(value.id, 1000) && string(value.sourceId, 200) && string(value.title, 5000) && EARTH_HAZARDS.includes(value.kind as EarthHazard)
    && ['unknown', 'minor', 'moderate', 'severe', 'extreme'].includes(String(value.severity)) && ['observed', 'forecast', 'warning'].includes(String(value.mode))
    && (value.latitude === null || finite(value.latitude, -90, 90)) && (value.longitude === null || finite(value.longitude, -180, 180))
    && finite(value.observedAt, 1, 8.64e15) && (value.expiresAt === null || finite(value.expiresAt, 1, 8.64e15)) && url(value.url)
    && typeof value.summary === 'string' && value.summary.length <= 5000 && string(value.status, 200) && string(value.provider, 200) && string(value.region, 200)
    && (value.lifecycle === undefined || ['cancelled', 'closed'].includes(String(value.lifecycle)))
    && (value.supersedes === undefined || Array.isArray(value.supersedes) && value.supersedes.length <= 30 && value.supersedes.every(id => string(id, 1000)))
    && (value.hazards === undefined || Array.isArray(value.hazards) && value.hazards.every(kind => EARTH_HAZARDS.includes(kind as EarthHazard)));
}
export function parseEarthWatchState(raw: unknown, now = Date.now()): EarthWatchState {
  const empty = emptyEarthWatchState(now);
  if (!object(raw) || raw.version !== 1 || typeof raw.scope !== 'string' || raw.scope.length > 10_000 || !finite(raw.initializedAt, 1, now + 60_000) || !finite(raw.updatedAt, 1, now + 60_000)) return empty;
  const records: EarthWatchRecord[] = Array.isArray(raw.records) ? raw.records.slice(0, 1000).flatMap(record => {
    if (!object(record) || !string(record.key, 1500) || !validEvent(record.event) || typeof record.version !== 'string' || record.version.length > 10_000
      || !finite(record.firstSeenAt, 1, now + 60_000) || !finite(record.lastSeenAt, Math.max(1, now - 7 * DAY), now + 60_000) || !Array.isArray(record.aliases)) return [];
    return [{ key: record.key, event: compact(record.event), version: record.version, firstSeenAt: record.firstSeenAt, lastSeenAt: record.lastSeenAt, aliases: record.aliases.filter((id): id is string => string(id, 1000)).slice(0, 30), missing: record.missing === true, expired: record.expired === true }];
  }).slice(0, 500) : [];
  const inbox: EarthWatchChange[] = Array.isArray(raw.inbox) ? raw.inbox.slice(0, 1000).flatMap(change => {
    if (!object(change) || !string(change.id, 2500) || !CHANGE_TYPES.includes(change.type as EarthWatchChangeType) || !validEvent(change.event)
      || !finite(change.at, Math.max(1, now - 7 * DAY), now + 60_000) || !string(change.locationId, 100)) return [];
    return [{ id: change.id, type: change.type as EarthWatchChangeType, title: String(change.title || '').slice(0, 500), event: compact(change.event), at: change.at, locationId: change.locationId, read: change.read === true }];
  }).slice(0, 200) : [];
  return { version: 1, scope: raw.scope, initializedAt: raw.initializedAt, updatedAt: raw.updatedAt, records, inbox, seenChanges: Array.isArray(raw.seenChanges) ? raw.seenChanges.filter((id): id is string => string(id, 2500)).slice(-2000) : inbox.map(change => change.id) };
}
export function loadEarthWatchState(now = Date.now()): EarthWatchState { return parseEarthWatchState(readStored(STATE_KEY), now); }
export function saveEarthWatchState(state: EarthWatchState): boolean { return writeStored(STATE_KEY, parseEarthWatchState(state)); }

/** Local, foreground-only monitoring. Missing data never establishes recovery. */
export function evaluateEarthWatch(previous: EarthWatchState | null, preferences: EarthWatchPreferences, snapshot: EarthWatchSnapshot, now = Date.now()): EarthWatchEvaluation {
  const currentScope = scope(preferences), old = previous ? parseEarthWatchState(previous, now) : emptyEarthWatchState(now);
  const location = preferences.locations.find(item => item.id === preferences.selectedLocationId);
  const baseline = old.scope !== currentScope || !old.scope;
  const sources = new Map(freshSources(snapshot.sources, now).map(source => [source.id, source]));
  const events = unique(snapshot.events).filter(event => sourceAvailable(sources.get(event.sourceId), now));
  const nearby = location ? getEarthWatchMatches(events, location, preferences, now) : { matches: [], unlocated: 0 };
  const records: EarthWatchRecord[] = baseline ? [] : old.records.map(record => ({ ...record, aliases: [...record.aliases] }));
  const inbox = old.inbox.slice(), seenChanges = new Set(old.seenChanges);
  const changes: EarthWatchChange[] = [], seen = new Set<string>();
  const emit = (type: EarthWatchChangeType, event: EarthEvent, record: EarthWatchRecord, v = version(event)) => {
    if (baseline || !location || !preferences.alertsEnabled) return;
    const id = `${location.id}|${record.key}|${type}|${hash(v)}`;
    if (seenChanges.has(id)) return;
    seenChanges.add(id);
    const titles: Record<EarthWatchChangeType, string> = { new: 'New matching event', escalated: 'Severity increased', updated: 'Provider update', expired: 'Original alert expiry reached', cancelled: 'Cancelled by provider', closed: 'Closed by provider', recovered: 'Provider reports recovery / containment', missing: 'No longer listed; outcome unconfirmed' };
    const change: EarthWatchChange = { id, type, title: titles[type], event: compact(event), at: now, locationId: location.id, read: false };
    inbox.unshift(change); changes.push(change);
  };
  // Apply explicit terminal records first, including those without a new point location.
  for (const event of events.filter(terminal)) {
    const ids = new Set([event.id, ...(event.supersedes || [])]);
    const record = records.find(item => item.aliases.some(id => ids.has(id)) || ids.has(item.event.id));
    if (!record || event.observedAt < record.event.observedAt) continue;
    seen.add(record.key);
    const v = version(event);
    if (record.version !== v && sourceFresh(sources.get(event.sourceId), now)) {
      const type = event.lifecycle === 'cancelled' || /\bcancelled|\bcanceled/i.test(event.status) ? 'cancelled'
        : event.lifecycle === 'closed' || /\bclosed\b/i.test(event.status) ? 'closed' : 'recovered';
      emit(type, event, record, v);
      record.event = compact(event); record.version = v; record.lastSeenAt = now; record.missing = false; record.expired = false;
    }
  }
  for (const match of nearby.matches) {
    const event = match.event, key = eventKey(event), v = version(event);
    let record = records.find(item => item.event.id === event.id || item.key === key || (event.supersedes || []).some(id => item.aliases.includes(id)));
    if (record) {
      seen.add(record.key);
      if (record.version !== v && sourceFresh(sources.get(event.sourceId), now)) emit(event.severity !== 'unknown' && record.event.severity !== 'unknown' && RANK[event.severity] > RANK[record.event.severity] ? 'escalated' : 'updated', event, record, v);
      record.event = compact(event); record.version = v; record.lastSeenAt = now; record.missing = false; record.expired = false;
      record.aliases = [...new Set([...record.aliases, event.id, ...(event.supersedes || [])])].slice(-30);
    } else {
      record = { key, event: compact(event), version: v, aliases: [event.id, ...(event.supersedes || [])].slice(-30), firstSeenAt: now, lastSeenAt: now, missing: false, expired: false };
      records.push(record); seen.add(key);
      if (sourceFresh(sources.get(event.sourceId), now)) emit('new', event, record, v);
    }
  }
  // A still-listed event that falls below thresholds or moves away is not a disappearance.
  for (const event of events.filter(item => !terminal(item))) {
    const record = records.find(item => item.event.id === event.id || (event.supersedes || []).some(id => item.aliases.includes(id)));
    if (!record || seen.has(record.key)) continue;
    seen.add(record.key);
    record.event = compact(event); record.version = version(event); record.lastSeenAt = now; record.missing = false; record.expired = false;
    record.aliases = [...new Set([...record.aliases, event.id, ...(event.supersedes || [])])].slice(-30);
  }
  if (!baseline) for (const record of records) {
    if (seen.has(record.key) || terminal(record.event)) continue;
    if (record.event.expiresAt !== null && record.event.expiresAt <= now) {
      if (!record.expired) emit('expired', record.event, record, `expired:${record.event.expiresAt}`);
      record.missing = true; record.expired = true;
    } else if (!record.missing && sourceFresh(sources.get(record.event.sourceId), now)) {
      emit('missing', record.event, record, record.version);
      record.missing = true;
    }
  }
  const state: EarthWatchState = { version: 1, scope: currentScope, initializedAt: baseline ? now : old.initializedAt, updatedAt: now,
    records: records.filter(record => record.lastSeenAt >= now - 7 * DAY).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 500),
    inbox: inbox.filter(change => change.at >= now - 7 * DAY).slice(0, 200), seenChanges: [...seenChanges].slice(-2000) };
  return { state, matches: nearby.matches, unlocated: nearby.unlocated, changes, baseline };
}

/** A deterministic 24-hour local summary of supplied provider records, not an AI forecast. */
export function buildEarthDailyBrief(events: EarthEvent[], location: EarthSavedLocation, preferences: EarthWatchPreferences, sources: EarthSource[], now = Date.now()): EarthDailyBrief {
  const aged = freshSources(sources, now), available = new Set(aged.filter(source => source.status !== 'unavailable').map(source => source.id));
  const windowStart = now - DAY;
  const nearby = getEarthWatchMatches(events.filter(event => event.observedAt >= windowStart && available.has(event.sourceId)), location, preferences, now);
  const counts: Partial<Record<EarthHazard, number>> = {};
  for (const { event } of nearby.matches) counts[event.kind] = (counts[event.kind] || 0) + 1;
  return { date: new Date(now).toISOString().slice(0, 10), generatedAt: now, windowStart, location: { ...location }, total: nearby.matches.length, counts,
    items: nearby.matches.slice(0, 20), sources: aged, unlocated: nearby.unlocated,
    coverage: 'Provider records issued or observed in the past 24 hours, within the selected radius and thresholds. Updated when the foreground panel refreshes. Alert-area centers and event points do not prove impact at your location; missing locations and unavailable feeds are excluded. No complete local all-clear is inferred.' };
}
