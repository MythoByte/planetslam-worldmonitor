import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEarthDailyBrief, DEFAULT_EARTH_WATCH_PREFERENCES, earthWatchDistanceKm, evaluateEarthWatch, getEarthWatchMatches, loadEarthWatchPreferences, loadEarthWatchState, parseEarthWatchPreferences, parseEarthWatchState, saveEarthWatchPreferences, saveEarthWatchState } from '../src/services/earth-watch.ts';
import type { EarthEvent, EarthSource } from '../src/types/earth.ts';
import type { EarthWatchPreferences, EarthWatchSnapshot } from '../src/types/earth-watch.ts';
const now = Date.now();
const location = { id: 'home', name: 'Synthetic home', latitude: 0, longitude: 0 };
const prefs = (patch: Partial<EarthWatchPreferences> = {}): EarthWatchPreferences => ({ ...DEFAULT_EARTH_WATCH_PREFERENCES, hazards: [...DEFAULT_EARTH_WATCH_PREFERENCES.hazards], locations: [location], selectedLocationId: 'home', ...patch });
const event = (patch: Partial<EarthEvent> = {}): EarthEvent => ({ id: 'nws:one', sourceId: 'nws', title: 'Synthetic coastal warning', kind: 'coastal', hazards: ['coastal', 'flood'], latitude: 0, longitude: 0,
  region: 'Synthetic', severity: 'moderate', mode: 'warning', status: 'Warning', observedAt: now - 1000, expiresAt: now + 3600_000,
  provider: 'Synthetic authority', summary: 'Synthetic only', url: 'https://example.org/alert', ...patch });
const source = (patch: Partial<EarthSource> = {}): EarthSource => ({ id: 'nws', provider: 'Synthetic authority', status: 'fresh', fetchedAt: now, observedAt: now - 1000, expiresAt: now + 86400_000, staleAt: now + 86400_000, coverage: 'Synthetic only', ...patch });
const snapshot = (events: EarthEvent[], sources = [source()]): EarthWatchSnapshot => ({ events, sources, fetchedAt: now });

test('saved locations and preferences validate persisted state, preserve genuine zeros and cap list length', () => {
  const p = parseEarthWatchPreferences({ locations: Array.from({ length: 13 }, (_, i) => ({ ...location, id: String(i) })), selectedLocationId: '2', radiusKm: -100, minMagnitude: 12, hazards: ['coastal', 'bogus', 'coastal'], minSeverity: 'severe', includeUnknown: false, alertsEnabled: false });
  assert.equal(p.locations.length, 10); assert.equal(p.locations[0]!.latitude, 0); assert.equal(p.selectedLocationId, '2');
  assert.equal(p.radiusKm, 250); assert.equal(p.minMagnitude, 2.5); assert.deepEqual(p.hazards, ['coastal']); assert.equal(p.includeUnknown, false); assert.equal(p.alertsEnabled, false);
  assert.deepEqual(parseEarthWatchPreferences({ locations: [{ ...location, latitude: null }, { ...location, id: 'bad', longitude: 181 }] }).locations, []);
  assert.deepEqual(parseEarthWatchPreferences({ hazards: [] }).hazards, []);
});
test('nearby thresholds handle antimeridian, magnitude and compound hazard tags without inventing coordinates', () => {
  assert.ok(earthWatchDistanceKm(0, 179.9, 0, -179.9) < 25);
  const result = getEarthWatchMatches([event(), event(), event({ id: 'unknown', severity: 'unknown' }), event({ id: 'far', latitude: 50 }), event({ id: 'unmapped', latitude: null, longitude: null })], location, prefs({ hazards: ['flood'], minSeverity: 'moderate', includeUnknown: false }), now);
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0]!.distanceKm, 0); assert.equal(result.unlocated, 1);
  const quakes = [event({ kind: 'earthquake', hazards: [], magnitude: 2 }), event({ id: 'big', kind: 'earthquake', hazards: [], magnitude: 5 }), event({ id: 'no-magnitude', kind: 'earthquake', hazards: [] })];
  assert.deepEqual(getEarthWatchMatches(quakes, location, prefs({ minMagnitude: 4 }), now).matches.map(item => item.event.id), ['big']);
});
test('initial monitoring establishes baseline and changes are deduplicated across refreshes and inbox clearing', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event()]), now);
  assert.equal(first.baseline, true); assert.equal(first.changes.length, 0); assert.equal(first.matches.length, 1);
  const second = evaluateEarthWatch(first.state, prefs(), snapshot([event(), event({ id: 'new' })]), now + 1000);
  assert.deepEqual(second.changes.map(change => change.type), ['new']);
  const same = evaluateEarthWatch({ ...second.state, inbox: [] }, prefs(), snapshot([event(), event({ id: 'new' })]), now + 2000);
  assert.equal(same.changes.length, 0); assert.equal(same.state.inbox.length, 0);
  const reset = evaluateEarthWatch(same.state, prefs({ radiusKm: 1000 }), snapshot([event({ id: 'third' })]), now + 3000);
  assert.equal(reset.baseline, true); assert.equal(reset.changes.length, 0);
});
test('official update references produce escalation rather than duplicate new and disappearance events', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event()]), now);
  const update = event({ id: 'nws:two', supersedes: ['nws:one'], severity: 'severe', observedAt: now + 1000 });
  const second = evaluateEarthWatch(first.state, prefs(), snapshot([event(), update]), now + 1000);
  assert.deepEqual(second.changes.map(change => change.type), ['escalated']); assert.equal(second.matches.length, 1); assert.equal(second.state.records.length, 1);
  assert.equal(evaluateEarthWatch(second.state, prefs(), snapshot([update]), now + 2000).changes.length, 0);
});
test('source outages and delayed feeds cannot invent event disappearance or recovery', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event()]), now);
  assert.equal(evaluateEarthWatch(first.state, prefs(), snapshot([], [source({ status: 'unavailable' })]), now + 1000).changes.length, 0);
  assert.equal(evaluateEarthWatch(first.state, prefs(), snapshot([], [source({ status: 'stale' })]), now + 1000).changes.length, 0);
  const missing = evaluateEarthWatch(first.state, prefs(), snapshot([]), now + 1000);
  assert.deepEqual(missing.changes.map(change => change.type), ['missing']); assert.match(missing.changes[0]!.title, /unconfirmed/);
  assert.equal(evaluateEarthWatch(missing.state, prefs(), snapshot([]), now + 2000).changes.length, 0);
  assert.equal(evaluateEarthWatch(first.state, prefs(), snapshot([event({ id: 'late-new' })], [source({ status: 'stale' })]), now + 1000).changes.length, 0);
});
test('explicit cancellation and closure use prior identity even without new coordinates and never imply recovery', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event()]), now);
  const cancel = event({ id: 'nws:cancel', sourceId: 'nws-cancel', supersedes: ['nws:one'], lifecycle: 'cancelled', status: 'Cancelled by provider', latitude: null, longitude: null, observedAt: now + 1000 });
  const cancelled = evaluateEarthWatch(first.state, prefs(), snapshot([cancel], [source(), source({ id: 'nws-cancel' })]), now + 1000);
  assert.deepEqual(cancelled.changes.map(change => change.type), ['cancelled']); assert.equal(cancelled.matches.length, 0);
  const close = event({ sourceId: 'eonet-closed', lifecycle: 'closed', status: 'Closed by provider', observedAt: now + 1000 });
  const closed = evaluateEarthWatch(first.state, prefs(), snapshot([close], [source(), source({ id: 'eonet-closed' })]), now + 1000);
  assert.deepEqual(closed.changes.map(change => change.type), ['closed']); assert.notEqual(closed.changes[0]!.type, 'recovered');
});
test('known warning expiry is labelled expiry, not cancellation or recovery, and cannot repeatedly refill cleared inbox', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event({ expiresAt: now + 1000 })]), now);
  const expired = evaluateEarthWatch(first.state, prefs(), snapshot([]), now + 2000);
  assert.deepEqual(expired.changes.map(change => change.type), ['expired']);
  assert.equal(evaluateEarthWatch({ ...expired.state, inbox: [] }, prefs(), snapshot([]), now + 3000).changes.length, 0);
});
test('monitoring opt-out maintains baseline without generating an inbox', () => {
  const p = prefs({ alertsEnabled: false }), first = evaluateEarthWatch(null, p, snapshot([event()]), now);
  assert.equal(evaluateEarthWatch(first.state, p, snapshot([event(), event({ id: 'two' })]), now + 1000).changes.length, 0);
  assert.equal(evaluateEarthWatch(first.state, prefs(), snapshot([event()]), now + 1000).baseline, true);
});
test('daily brief is dated UTC with actual 24h records, links and coverage rather than a fabricated all-clear', () => {
  const brief = buildEarthDailyBrief([event(), event({ id: 'old', observedAt: now - 2 * 86400_000 }), event({ id: 'no-location', latitude: null })], location, prefs(), [source()], now);
  assert.equal(brief.date, new Date(now).toISOString().slice(0, 10)); assert.equal(brief.total, 1); assert.equal(brief.unlocated, 1); assert.equal(brief.counts.coastal, 1); assert.equal(brief.items[0]!.event.url, 'https://example.org/alert'); assert.equal(brief.windowStart, now - 86400_000);
  const outage = buildEarthDailyBrief([event()], location, prefs(), [source({ status: 'unavailable' })], now);
  assert.equal(outage.total, 0); assert.match(outage.coverage, /No complete local all-clear/); assert.equal(outage.sources[0]!.status, 'unavailable');
});
test('persisted tracking payloads reject unsafe links, malformed event arrays and expire old records', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event()]), now);
  assert.equal(parseEarthWatchState({ ...first.state, records: [{ ...first.state.records[0], event: event({ url: 'javascript:alert(1)' }) }] }, now).records.length, 0);
  assert.equal(parseEarthWatchState(first.state, now + 8 * 86400_000).records.length, 0);
  assert.equal(parseEarthWatchState({ ...first.state, records: false, inbox: [null] }, now).records.length, 0);
});

test('lowered severity and moved events are not falsely labelled no longer listed', () => {
  const p = prefs({ minSeverity: 'severe' }), first = evaluateEarthWatch(null, p, snapshot([event({ severity: 'severe' })]), now);
  const lowered = evaluateEarthWatch(first.state, p, snapshot([event({ severity: 'minor', observedAt: now + 1000 })]), now + 1000);
  assert.equal(lowered.matches.length, 0); assert.equal(lowered.changes.length, 0); assert.equal(lowered.state.records[0]!.event.severity, 'minor');
  const moved = evaluateEarthWatch(first.state, p, snapshot([event({ severity: 'severe', latitude: 60, observedAt: now + 1000 })]), now + 1000);
  assert.equal(moved.changes.length, 0); assert.equal(moved.matches.length, 0);
});
test('new cancellation defeats an overlapping older active cache, while old closure cannot end a newer reopened record', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event()]), now);
  const cancel = event({ id: 'nws:cancel', sourceId: 'nws-cancel', supersedes: ['nws:one'], lifecycle: 'cancelled', status: 'Cancelled', observedAt: now + 1000 });
  const cancelled = evaluateEarthWatch(first.state, prefs(), snapshot([event(), cancel], [source(), source({ id: 'nws-cancel' })]), now + 1000);
  assert.equal(cancelled.matches.length, 0); assert.deepEqual(cancelled.changes.map(change => change.type), ['cancelled']);
  const newer = event({ observedAt: now + 2000 });
  const next = evaluateEarthWatch(null, prefs(), snapshot([newer]), now + 2000);
  const oldClose = event({ sourceId: 'eonet-closed', lifecycle: 'closed', status: 'Closed', observedAt: now - 1000 });
  const reopened = evaluateEarthWatch(next.state, prefs(), snapshot([newer, oldClose], [source(), source({ id: 'eonet-closed' })]), now + 3000);
  assert.equal(reopened.matches.length, 1); assert.equal(reopened.changes.length, 0);
});

test('stale refreshes remain quiet while the known original expiry still produces one explicit expiry event', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event({ expiresAt: now + 2000 })]), now);
  const stale = evaluateEarthWatch(first.state, prefs(), snapshot([event({ expiresAt: now + 2000, summary: 'Delayed snapshot revision' })], [source({ status: 'stale' })]), now + 1000);
  assert.equal(stale.changes.length, 0);
  const expired = evaluateEarthWatch(stale.state, prefs(), snapshot([], [source({ status: 'unavailable' })]), now + 3000);
  assert.deepEqual(expired.changes.map(change => change.type), ['expired']);
  const again = evaluateEarthWatch(expired.state, prefs(), snapshot([], [source({ status: 'unavailable' })]), now + 4000);
  assert.equal(again.changes.length, 0);
});

test('preferences and alert storage report blocked writes accurately instead of claiming persistence', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    assert.equal(saveEarthWatchPreferences(prefs()), true); assert.equal(loadEarthWatchPreferences().locations[0]!.id, 'home');
    const first = evaluateEarthWatch(null, prefs(), snapshot([event()]), now);
    assert.equal(saveEarthWatchState(first.state), true); assert.equal(loadEarthWatchState(now).records.length, 1);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage blocked'); } });
    assert.equal(saveEarthWatchPreferences(prefs()), false); assert.equal(saveEarthWatchState(first.state), false);
    assert.deepEqual(loadEarthWatchPreferences().locations, []);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => { throw new Error('Quota full'); } } });
    assert.equal(saveEarthWatchPreferences(prefs()), false);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('an unknown severity becoming known is an update rather than evidence of escalation', () => {
  const first = evaluateEarthWatch(null, prefs(), snapshot([event({ severity: 'unknown' })]), now);
  const known = evaluateEarthWatch(first.state, prefs(), snapshot([event({ severity: 'severe', observedAt: now + 1000 })]), now + 1000);
  assert.deepEqual(known.changes.map(change => change.type), ['updated']);
});

test('recovery requires an explicit positive provider status rather than a negated mention', () => {
 const first=evaluateEarthWatch(null,prefs(),snapshot([event()]),now);
 for(const status of ['Not recovered','Not contained','Recovery not confirmed']) {
  const result=evaluateEarthWatch(first.state,prefs(),snapshot([event({status,observedAt:now+1000})]),now+1000);
  assert.equal(result.changes.some(change=>change.type==='recovered'),false);
  assert.equal(result.matches.length,1);
 }
 const positive=evaluateEarthWatch(first.state,prefs(),snapshot([event({status:'Contained by provider',observedAt:now+1000})]),now+1000);
 assert.deepEqual(positive.changes.map(change=>change.type),['recovered']);
});
