import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTestI18n } from './helpers/i18n.mts';
import type { SpacePassPrediction } from '@/types/space-observing';
import type { SpaceEnvelope, SpaceMissionEvent } from '@/types/space';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), predict: vi.fn(), prepare: vi.fn(async () => []),
  enable: vi.fn(async () => ({ enabled: true })), disable: vi.fn(), publishNotice: vi.fn(),
  geo: vi.fn(), stop: vi.fn(), start: vi.fn(),
}));
vi.mock('@/services/space', () => ({ fetchSpaceDataset: mocks.fetch }));
vi.mock('@/services/space-orbits', () => ({ prepareSpaceOrbits: mocks.prepare, getPublishedSpaceOrbitSnapshot: () => ({ selectedId: '25544' }) }));
vi.mock('@/services/space-observing', () => ({
  predictSpacePasses: mocks.predict,
  calculateMoonPhase: () => ({ phaseName: 'Waxing crescent', illumination: .25, approximateAgeDays: 5, waxing: true }),
}));
vi.mock('@/services/space-notifications', () => ({
  getSpaceNotificationState: () => ({ enabled: false, supported: true, permission: 'default', deliveryError: null }),
  enableSpaceNotifications: mocks.enable, disableSpaceNotifications: mocks.disable,
  subscribeSpaceNotificationState: () => () => {}, startSpaceNotifications: mocks.start,
  setSpacePassNotificationSnapshot: mocks.publishNotice,
  spaceObserverKey: (observer: { latitude: number; longitude: number; altitudeM: number }) => `${observer.latitude},${observer.longitude},${observer.altitudeM}`,
}));
import { SpaceObservingPanel } from '@/components/SpaceObservingPanel';
import { SpaceMissionsPanel, missionScheduleLabel } from '@/components/SpaceMissionsPanel';
import { SpaceDataPanel } from '@/components/SpaceDashboardPanels';
import { getSpacePreferences, setSpaceObserver } from '@/services/space-personalization';

const panels: Array<{ destroy(): void }> = [];
function mount<T extends { destroy(): void; getElement(): HTMLElement; notifyConnected(): void }>(panel: T): T {
  panels.push(panel); document.body.append(panel.getElement()); panel.notifyConnected(); return panel;
}
function prediction(observer = { latitude: 45, longitude: -75, altitudeM: 0 }): SpacePassPrediction {
  const now = Date.now();
  const pass = { noradId: '25544', name: 'ISS TEST', aosAt: now + 600_000, peakAt: now + 800_000, losAt: now + 1000_000,
    maxElevationDeg: 40, aosAzimuthDeg: 0, peakAzimuthDeg: 90, losAzimuthDeg: 180, aosDirection: 'N', peakDirection: 'E', losDirection: 'S',
    ongoing: false, endsAfterWindow: false, visible: true, visibleWindows: [{ startAt: now + 650_000, endAt: now + 950_000, maxElevationDeg: 40 }],
    visibleAtPeak: true, observerSunElevationAtPeakDeg: -10, satelliteSunlitAtPeak: true,
    sourceStatus: 'fresh' as const, sourceExpiresAt: now + 86400_000, elementEpoch: now, elementStatus: 'fresh' as const };
  return { generatedAt: now, windowStart: now, windowEnd: now + 86400_000, observer, passes: [pass],
    satellites: [{ noradId: '25544', name: 'ISS TEST', status: 'predicted', sourceStatus: 'fresh', elementEpoch: now, elementStatus: 'fresh', sourceExpiresAt: now + 86400_000, passes: [pass] }], requestedCount: 1, processedCount: 1, truncated: false };
}
function envelope(dataset: string, data: unknown): SpaceEnvelope<unknown> {
  return { dataset: dataset as SpaceEnvelope<unknown>['dataset'], status: 'fresh', provider: 'Synthetic fixture', sourceUrl: 'https://example.com/data', fetchedAt: Date.now(), observedAt: Date.now(), expiresAt: Date.now() + 86400_000, data };
}
function mission(): SpaceMissionEvent {
  return { id: '22', name: 'Synthetic docking <script>', kind: 'docking', type: 'Docking', description: 'Synthetic mission for tests.',
    date: Date.parse('2027-02-03T12:34:00Z'), datePrecision: 'month', datePrecisionDescription: 'Month estimate',
    windowStart: null, windowEnd: null, durationSeconds: null, location: 'Orbit', status: 'Scheduled · provider estimate',
    webcastUrl: '', url: 'https://example.com/mission', launchIds: [], updatedAt: null };
}

beforeAll(initTestI18n);
beforeEach(() => {
  vi.stubGlobal('navigator', Object.defineProperty(Object.create(navigator), 'geolocation', { value: { getCurrentPosition: mocks.geo }, configurable: true }));
  mocks.start.mockReturnValue(mocks.stop);
  mocks.predict.mockImplementation(async (_prepared, options) => prediction(options.observer));
  mocks.fetch.mockImplementation(async dataset => envelope(dataset, dataset === 'orbits' ? { items: [], groups: [], complete: true } : dataset === 'missions' ? { items: [mission()], totalCount: 1, truncated: false } : { items: [{ id: 'launch-1', name: 'Synthetic launch', net: Date.now() + 600000, windowStart: null, windowEnd: null, status: 'Go', provider: 'SpaceX', rocket: 'Falcon', mission: 'Synthetic fixture', pad: 'Pad', latitude: 0, longitude: 0, webcastUrl: '', url: 'https://example.com/launch' }] }));
});
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  localStorage.clear(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockClear();
});

describe('Space observing and mission UI', () => {
  it('never requests location or notification permission on mount and computes only after explicit location save', async () => {
    const panel = mount(new SpaceObservingPanel());
    expect(mocks.geo).not.toHaveBeenCalled(); expect(mocks.enable).not.toHaveBeenCalled(); expect(mocks.predict).not.toHaveBeenCalled();
    expect(panel.getElement().textContent).toContain('25% illuminated');
    for (const [selector, value] of [['[data-observer-lat]', '45'], ['[data-observer-lon]', '-75']]) {
      const input = panel.getElement().querySelector<HTMLInputElement>(selector!)!; input.value = value!; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    panel.getElement().querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(panel.getElement().querySelector('[data-observing-pass="25544"]')).not.toBeNull());
    expect(getSpacePreferences().observer).toEqual({ latitude: 45, longitude: -75, altitudeM: 0 });
    expect(mocks.fetch.mock.calls.every(args => typeof args[0] === 'string' && !args.some(value => typeof value === 'object'))).toBe(true);
    expect(panel.getElement().textContent).toContain('ISS visibility candidate');
    const notice = mocks.publishNotice.mock.calls.filter(([value]) => value !== null).at(-1)![0];
    expect(notice.expiresAt - notice.computedAt).toBe(86400_000);
    expect(notice.items[0].elementEpoch).toBe(notice.computedAt);
    expect(notice.items[0].riseAt - notice.computedAt).toBe(650_000);
    expect(mocks.enable).not.toHaveBeenCalled();
    panel.getElement().querySelector<HTMLButtonElement>('[data-notifications-enable]')!.click();
    expect(mocks.enable).toHaveBeenCalledOnce();
  });

  it('requests geolocation only on click and ignores a late response after clearing location', async () => {
    const panel = mount(new SpaceObservingPanel());
    panel.getElement().querySelector<HTMLButtonElement>('[data-observer-geolocate]')!.click();
    expect(mocks.geo).toHaveBeenCalledOnce();
    const callback = mocks.geo.mock.calls[0]![0] as PositionCallback;
    panel.getElement().querySelector<HTMLButtonElement>('[data-observer-clear]')!.click();
    callback({ coords: { latitude: 12, longitude: 34, altitude: 0 } } as GeolocationPosition);
    expect(getSpacePreferences().observer).toBeNull();
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it('aborts pending predictions and clears reminder snapshots when destroyed', async () => {
    setSpaceObserver({ latitude: 45, longitude: -75, altitudeM: 0 });
    let resolve: ((value: SpacePassPrediction) => void) | undefined;
    mocks.predict.mockImplementationOnce(() => new Promise<SpacePassPrediction>(done => { resolve = done; }));
    const panel = mount(new SpaceObservingPanel());
    await vi.waitFor(() => expect(mocks.predict).toHaveBeenCalled());
    const signal = mocks.predict.mock.calls[0]![1].signal as AbortSignal;
    panel.destroy(); expect(signal.aborted).toBe(true);
    resolve!(prediction()); await Promise.resolve(); await Promise.resolve();
    expect(mocks.publishNotice).toHaveBeenLastCalledWith(null);
    expect(mocks.stop).toHaveBeenCalled();
  });

  it('preserves imprecise mission dates, escapes publisher text, and saves event and launch watches', async () => {
    const panel = mount(new SpaceMissionsPanel());
    await vi.waitFor(() => expect(panel.getElement().querySelector('[data-mission-watch="22"]')).not.toBeNull());
    expect(missionScheduleLabel(mission())).toBe('2027-02 · month estimate');
    expect(panel.getElement().textContent).not.toContain('12:34');
    expect(panel.getElement().querySelector('script')).toBeNull();
    panel.getElement().querySelector<HTMLButtonElement>('[data-mission-watch="22"]')!.click();
    expect(getSpacePreferences().missionWatchlist).toEqual(['22']);
    const launches = mount(new SpaceDataPanel('space-launches', 'Launch Countdown', 'launches'));
    await vi.waitFor(() => expect(launches.getElement().querySelector('[data-launch-watch="launch-1"]')).not.toBeNull());
    launches.getElement().querySelector<HTMLButtonElement>('[data-launch-watch="launch-1"]')!.click();
    expect(getSpacePreferences().launchWatchlist).toEqual(['launch-1']);
    const observing = mount(new SpaceObservingPanel());
    observing.getElement().querySelector<HTMLButtonElement>('[data-space-unwatch="22"]')!.click();
    expect(getSpacePreferences().missionWatchlist).toEqual([]);
  });
});
