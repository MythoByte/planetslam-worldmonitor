import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({ fetch: vi.fn(), prefs: { observer: { latitude: 40, longitude: -75, altitudeM: 0 } as { latitude: number; longitude: number; altitudeM: number } | null, horizonHours: 24, satelliteWatchlist: ['25544'], launchWatchlist: ['launch'], missionWatchlist: ['mission'] }, changed: null as null | (() => void) }));
vi.mock('@/services/space', () => ({ fetchSpaceDataset: fixtures.fetch }));
vi.mock('@/services/space-personalization', () => ({ getSpacePreferences: () => fixtures.prefs, subscribeSpacePreferences: (fn: () => void) => { fixtures.changed = fn; return () => { fixtures.changed = null; }; } }));
let permission: NotificationPermission;
const shown: { title: string; options: NotificationOptions }[] = [];
let request = vi.fn();
function installNotifications() {
  vi.stubGlobal('Notification', class {
    static get permission() { return permission; }
    static requestPermission() { return request(); }
    onclick: (() => void) | null = null;
    constructor(title: string, options: NotificationOptions) { shown.push({ title, options }); }
    close() {}
  });
}
function envelope(dataset: string, items: unknown[], status = 'fresh') {
  return { dataset, status, provider: 'Synthetic', fetchedAt: Date.now(), observedAt: Date.now(), expiresAt: Date.now() + 3600_000, data: { items } };
}
function launch(at = Date.now() + 4 * 60_000, status = 'Go for launch') { return { id: 'launch', name: 'Test launch', net: at, status }; }
function mission(at = Date.now() + 4 * 60_000, datePrecision = 'minute') { return { id: 'mission', name: 'Test docking', date: at, datePrecision, status: 'Scheduled' }; }
function sources(launches: unknown[] = [], missions: unknown[] = []) {
  const epoch = Date.now();
  fixtures.fetch.mockImplementation(async (dataset: string) => dataset === 'orbits'
    ? { ...envelope(dataset, [{ noradId: '25544', epoch, groups: ['stations'] }]), data: { items: [{ noradId: '25544', epoch, groups: ['stations'] }], groups: [{ id: 'stations', status: 'fresh', fetchedAt: Date.now(), refreshFailed: false }] } }
    : envelope(dataset, dataset === 'launches' ? launches : missions));
}
async function service() { return import('@/services/space-notifications'); }
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); shown.length = 0; permission = 'default';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  request = vi.fn(async () => { permission = 'granted'; return 'granted'; }); installNotifications();
  fixtures.prefs = { observer: { latitude: 40, longitude: -75, altitudeM: 0 }, horizonHours: 24, satelliteWatchlist: ['25544'], launchWatchlist: ['launch'], missionWatchlist: ['mission'] };
  fixtures.fetch.mockReset(); fixtures.changed = null; sources();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Space reminders respect explicit authorization and current source data', () => {
  it('never requests permission or fetches notifications before an explicit opt-in', async () => {
    const api = await service(); const stop = api.startSpaceNotifications();
    await api.checkSpaceNotifications(); expect(request).not.toHaveBeenCalled(); expect(fixtures.fetch).not.toHaveBeenCalled(); expect(shown).toHaveLength(0); stop();
  });
  it('keeps denied or unsupported notifications disabled', async () => {
    permission = 'denied'; const api = await service(); expect((await api.enableSpaceNotifications()).enabled).toBe(false);
    expect(request).not.toHaveBeenCalled(); vi.stubGlobal('Notification', undefined);
    expect((await api.enableSpaceNotifications()).supported).toBe(false); expect(shown).toHaveLength(0);
  });
  it('deduplicates accurate upcoming watched events across repeated checks and reloads', async () => {
    sources([launch()], [mission()]); let api = await service(); await api.enableSpaceNotifications();
    await api.checkSpaceNotifications(); await api.checkSpaceNotifications(); expect(shown).toHaveLength(2);
    vi.resetModules(); api = await service(); await api.checkSpaceNotifications(); expect(shown).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('suppresses stale, past, canceled and imprecise event reminders', async () => {
    sources([launch(Date.now() - 1), launch(Date.now() + 60000, 'Canceled')], [mission(Date.now() + 60000, 'day')]);
    const api = await service(); await api.enableSpaceNotifications(); await api.checkSpaceNotifications(); expect(shown).toHaveLength(0);
    fixtures.fetch.mockImplementation(async (dataset: string) => envelope(dataset, dataset === 'launches' ? [launch()] : [mission()], 'stale'));
    await api.checkSpaceNotifications(); expect(shown).toHaveLength(0);
  });
  it('replaces postponed schedules and emits a single change notice for a revised imminent time', async () => {
    const api = await service(); await api.enableSpaceNotifications(); sources([launch(Date.now() + 3600_000)]); await api.checkSpaceNotifications();
    sources([launch(Date.now() + 3 * 60_000)]); await api.checkSpaceNotifications(); await api.checkSpaceNotifications();
    expect(shown).toHaveLength(1); expect(shown[0]!.title).toContain('schedule updated');
    sources([]); await api.checkSpaceNotifications(); expect(shown).toHaveLength(1);
  });
  it('invalidates location, age, watch and source changes for predicted pass reminders', async () => {
    const api = await service(); await api.enableSpaceNotifications();
    const snapshot = { computedAt: Date.now(), expiresAt: Date.now() + 3600_000, observerKey: api.spaceObserverKey(fixtures.prefs.observer), items: [{ id: 'p1', noradId: '25544', name: 'ISS', elementEpoch: Date.now(), riseAt: Date.now() + 240000, visible: true, sourceStatus: 'stale' as const }] };
    api.setSpacePassNotificationSnapshot(snapshot); await api.checkSpaceNotifications(); expect(shown).toHaveLength(0);
    api.setSpacePassNotificationSnapshot({ ...snapshot, observerKey: 'wrong', items: [{ ...snapshot.items[0]!, sourceStatus: 'fresh' }] }); await api.checkSpaceNotifications(); expect(shown).toHaveLength(0);
    api.setSpacePassNotificationSnapshot({ ...snapshot, items: [{ ...snapshot.items[0]!, sourceStatus: 'fresh' }] }); await api.checkSpaceNotifications(); expect(shown).toHaveLength(1);
    expect(shown[0]!.options.tag).not.toContain('40.00000');
    expect(shown[0]!.options.tag).not.toContain('-75.00000');
    // Recomputed AOS jitter represents the same physical pass, including after a reload.
    vi.resetModules(); const reloaded = await service(); reloaded.setSpacePassNotificationSnapshot({ ...snapshot, items: [{ ...snapshot.items[0]!, id: 'p1-refined', riseAt: snapshot.items[0]!.riseAt + 2000, sourceStatus: 'fresh' }] });
    await reloaded.checkSpaceNotifications(); expect(shown).toHaveLength(1);
  });
  it('revokes pending reads on disable and pending permission requests on a later disable', async () => {
    let resolvePermission!: (permission: NotificationPermission) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { resolvePermission = resolve; }));
    const api = await service(); const enabling = api.enableSpaceNotifications(); api.disableSpaceNotifications();
    permission = 'granted'; resolvePermission('granted'); await enabling; expect(api.getSpaceNotificationState().enabled).toBe(false);
    await api.enableSpaceNotifications();
    let resolveFetch!: (value: unknown) => void;
    fixtures.prefs.missionWatchlist = [];
    fixtures.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveFetch = resolve; }));
    const checking = api.checkSpaceNotifications(); api.disableSpaceNotifications(); resolveFetch(envelope('launches', [launch()])); await checking;
    expect(shown).toHaveLength(0);
  });
  it('cleans up its interval and suppresses an in-flight read when the final owner closes', async () => {
    const api = await service(); await api.enableSpaceNotifications();
    let resolveFetch!: (value: unknown) => void; fixtures.prefs.missionWatchlist = [];
    fixtures.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveFetch = resolve; }));
    const stop = api.startSpaceNotifications(); stop(); resolveFetch(envelope('launches', [launch()]));
    await Promise.resolve(); await Promise.resolve(); await api.checkSpaceNotifications();
    expect(shown).toHaveLength(0); expect(vi.getTimerCount()).toBe(0); expect(fixtures.changed).toBeNull();
  });
  it('honors a disable from another tab and suppresses checks when another tab owns the delivery lock', async () => {
    const api = await service(); await api.enableSpaceNotifications();
    const stop = api.startSpaceNotifications();
    localStorage.setItem('planetslam-space-notifications-enabled-v1', 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: 'planetslam-space-notifications-enabled-v1' }));
    expect(api.getSpaceNotificationState().enabled).toBe(false);
    await Promise.resolve(); await Promise.resolve();
    await api.enableSpaceNotifications(); sources([launch()], [mission()]);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name, _options, callback) => callback(null)) } });
    await api.checkSpaceNotifications(); expect(shown).toHaveLength(0);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); stop();
  });
  it('can remind from an older page-open prediction after revalidating unchanged fresh elements', async () => {
    const api = await service(); await api.enableSpaceNotifications();
    const epoch = Date.now();
    api.setSpacePassNotificationSnapshot({ computedAt: epoch, expiresAt: epoch + 86400_000,
      observerKey: api.spaceObserverKey(fixtures.prefs.observer), items: [{ id: 'later-pass', noradId: '25544', name: 'ISS', elementEpoch: epoch,
        riseAt: epoch + 3600_000 + 240000, visible: true, sourceStatus: 'fresh' }] });
    vi.setSystemTime(epoch + 3600_000); await api.checkSpaceNotifications();
    expect(shown).toHaveLength(1); expect(shown[0]!.title).toContain('satellite pass');
  });
  it('suppresses old pass predictions after the provider changes the orbital element epoch', async () => {
    const api = await service(); await api.enableSpaceNotifications(); const epoch = Date.now();
    api.setSpacePassNotificationSnapshot({ computedAt: epoch, expiresAt: epoch + 86400_000,
      observerKey: api.spaceObserverKey(fixtures.prefs.observer), items: [{ id: 'old-pass', noradId: '25544', name: 'ISS', elementEpoch: epoch,
        riseAt: epoch + 240000, visible: true, sourceStatus: 'fresh' }] });
    vi.setSystemTime(epoch + 1000); sources(); await api.checkSpaceNotifications(); expect(shown).toHaveLength(0);
  });
  it('keeps coarse current-period schedule changes informational, never five-minute reminders', async () => {
    const api = await service(); await api.enableSpaceNotifications();
    sources([], [mission(Date.UTC(2026, 10, 1), 'month')]); await api.checkSpaceNotifications(); expect(shown).toHaveLength(0);
    sources([], [mission(Date.UTC(2026, 10, 6), 'day')]); await api.checkSpaceNotifications(); await api.checkSpaceNotifications();
    expect(shown).toHaveLength(1); expect(shown[0]!.title).toContain('schedule updated');
    expect(shown[0]!.options.body).toContain('day estimate');
  });
});
