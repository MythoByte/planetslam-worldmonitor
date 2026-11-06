import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTestI18n } from './helpers/i18n.mts';
import type { OrbitCatalogData, OrbitGroupId, OrbitObject, SpaceEnvelope } from '@/types/space';
import type { SpaceOrbitSnapshot } from '@/types/space-orbits';

const source = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/services/space', () => ({ fetchSpaceDataset: source.fetch }));
import { SatelliteTrackerPanel, normalizeSatelliteTrackerPrefs } from '@/components/SatelliteTrackerPanel';
import { getSpacePreferences } from '@/services/space-personalization';

const panels: SatelliteTrackerPanel[] = [];
const published: SpaceOrbitSnapshot[] = [];
const PREFS_KEY = 'planetslam-space-satellites-v1';

function object(noradId: string, name: string, group: OrbitGroupId, epoch = Date.now()): OrbitObject {
  return { noradId, name, objectId: '2026-001A', epoch, groups: [group], elementStatus: 'fresh', omm: {
    OBJECT_NAME: name, OBJECT_ID: '2026-001A', EPOCH: new Date(epoch).toISOString().replace('Z', ''),
    NORAD_CAT_ID: Number(noradId), MEAN_MOTION: 15.5, ECCENTRICITY: 0.0004, INCLINATION: 51.64,
    RA_OF_ASC_NODE: 120, ARG_OF_PERICENTER: 50, MEAN_ANOMALY: 30, ELEMENT_SET_NO: 999,
    BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
  } };
}
function envelope(): SpaceEnvelope<OrbitCatalogData> {
  const now = Date.now();
  return { dataset: 'orbits', status: 'fresh', provider: 'Synthetic orbital fixture', sourceUrl: 'https://example.com/gp',
    fetchedAt: now, observedAt: now, expiresAt: now + 72 * 3600_000, data: {
      complete: true, items: [object('25544', 'ISS TEST', 'stations'), object('100001', 'STARLINK TEST', 'starlink')],
      groups: (['stations', 'weather', 'science', 'communications', 'starlink'] as const).map(id => ({
        id, label: id, providerGroup: id, sourceUrl: 'https://example.com/gp', status: 'fresh', fetchedAt: now,
        objectCount: id === 'stations' || id === 'starlink' ? 1 : 0, totalCount: 1, truncated: false,
      })),
    },
  };
}
async function mount(): Promise<SatelliteTrackerPanel> {
  const panel = new SatelliteTrackerPanel(); panels.push(panel);
  document.body.append(panel.getElement()); panel.notifyConnected();
  await vi.waitFor(() => expect(panel.getElement().querySelector('[data-orbit-status]')?.getAttribute('data-orbit-status')).not.toBe('loading'));
  return panel;
}
function selected(panel: SatelliteTrackerPanel): string {
  return panel.getElement().querySelector('[data-orbit-selected]')?.textContent || '';
}

beforeAll(initTestI18n);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  source.fetch.mockResolvedValue(envelope());
  published.length = 0;
  window.addEventListener('planetslam:space-orbits', capture);
});
function capture(event: Event): void { published.push((event as CustomEvent<SpaceOrbitSnapshot>).detail); }
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  window.removeEventListener('planetslam:space-orbits', capture);
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); source.fetch.mockReset();
  localStorage.clear(); document.body.replaceChildren();
});

describe('Satellite tracker', () => {
  it('saves and removes a satellite watch without changing the selected object', async () => {
    const panel = await mount();
    panel.getElement().querySelector<HTMLButtonElement>('[data-orbit-watch="25544"]')!.click();
    expect(getSpacePreferences().satelliteWatchlist).toEqual(['25544']);
    expect(panel.getElement().querySelector('[data-orbit-watch="25544"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(published.at(-1)?.selected?.noradId).toBe('25544');
    panel.getElement().querySelector<HTMLButtonElement>('[data-orbit-watch="25544"]')!.click();
    expect(getSpacePreferences().satelliteWatchlist).toEqual([]);
  });

  it('rejects invalid saved preferences and selects ISS by default', async () => {
    for (const raw of [null, [], 'starlink', { group: 'unknown', selectedId: '<script>' }, { group: 3, selectedId: -1 }]) {
      expect(normalizeSatelliteTrackerPrefs(raw)).toEqual({ group: 'stations', selectedId: '25544' });
    }
    localStorage.setItem(PREFS_KEY, '{"group":"unknown","selectedId":"javascript:alert(1)"}');
    const panel = await mount();
    expect(selected(panel)).toContain('ISS TEST');
    expect(selected(panel)).toContain('Calculated position');
    expect(selected(panel)).toContain('km/s');
    expect(published.at(-1)?.selected?.noradId).toBe('25544');
    const search = panel.getElement().querySelector<HTMLInputElement>('[data-orbit-search]')!;
    search.value = 'iss test'; search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel.getElement().querySelectorAll('[data-orbit-id]')).toHaveLength(1);
  });

  it('searches across groups by NORAD and persists the explicit selection and group', async () => {
    const panel = await mount();
    const input = panel.getElement().querySelector<HTMLInputElement>('[data-orbit-search]')!;
    input.focus(); input.value = '100001'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.activeElement).toBe(panel.getElement().querySelector('[data-orbit-search]'));
    panel.getElement().querySelector<HTMLButtonElement>('[data-orbit-id="100001"]')!.click();
    expect(selected(panel)).toContain('STARLINK TEST');
    const group = panel.getElement().querySelector<HTMLSelectElement>('[data-orbit-group]')!;
    group.value = 'starlink'; group.dispatchEvent(new Event('change', { bubbles: true }));
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toEqual({ group: 'starlink', selectedId: '100001' });
    panel.destroy();
    const restored = await mount();
    expect(selected(restored)).toContain('STARLINK TEST');
    expect(restored.getElement().querySelector<HTMLSelectElement>('[data-orbit-group]')?.value, restored.getElement().querySelector('[data-orbit-group]')?.outerHTML).toBe('starlink');
  });

  it('escapes provider text and retains a clear unavailable state through retry and recovery', async () => {
    source.fetch.mockResolvedValueOnce({ ...envelope(), status: 'unavailable', data: null });
    const panel = await mount();
    expect(selected(panel)).toContain('unavailable');
    expect(published.at(-1)?.selected).toBeNull();
    const data = envelope(); data.data!.items[0]!.name = '<img src=x onerror=alert(1)>ISS';
    source.fetch.mockResolvedValue(data);
    panel.getElement().querySelector<HTMLButtonElement>('[data-orbit-retry]')!.click();
    await vi.waitFor(() => expect(selected(panel)).toContain('<img src=x onerror=alert(1)>ISS'));
    expect(source.fetch).toHaveBeenLastCalledWith('orbits', true);
    expect(panel.getElement().querySelector('[data-orbit-selected] img')).toBeNull();
    expect(published.at(-1)?.selected?.noradId).toBe('25544');
  });

  it('continues bounded map updates while the tracker is offscreen and clears on destroy', async () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { observerCallback = callback; }
      observe() {} disconnect() {}
    });
    const panel = await mount();
    const before = published.at(-1)!;
    observerCallback!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    vi.advanceTimersByTime(5000);
    expect(published.at(-1)?.calculatedAt).toBeGreaterThan(before.calculatedAt);
    expect(published.at(-1)?.selected?.latitude).not.toBe(before.selected?.latitude);
    expect(source.fetch).toHaveBeenCalledTimes(1);
    panel.destroy();
    expect(published.at(-1)?.selected).toBeNull();
    const count = published.length; vi.advanceTimersByTime(10_000);
    expect(published).toHaveLength(count);
  });

  it('clears a selected object when its source group expires even while another group stays current', async () => {
    const data = envelope();
    const stations = data.data!.groups.find(group => group.id === 'stations')!;
    stations.fetchedAt = Date.now() - 48 * 3600_000 + 60_000;
    stations.status = 'stale';
    source.fetch.mockResolvedValue(data);
    const panel = await mount();
    expect(published.at(-1)?.selected?.noradId).toBe('25544');
    vi.setSystemTime(Date.now() + 120_000); vi.advanceTimersByTime(5000);
    expect(published.at(-1)?.selected).toBeNull();
    expect(selected(panel)).toContain('unavailable');
    expect(panel.getElement().querySelector('[data-orbit-id="25544"]')).toBeNull();
  });

  it('labels stale elements and clears positions and tracks once the element age expires', async () => {
    const data = envelope();
    data.data!.items[0] = object('25544', 'ISS OLD ELEMENTS', 'stations', Date.now() - 7 * 86400_000 + 60_000);
    source.fetch.mockResolvedValue(data);
    const panel = await mount();
    expect(selected(panel)).toContain('Stale orbital elements');
    vi.setSystemTime(Date.now() + 120_000); vi.advanceTimersByTime(5000);
    expect(published.at(-1)?.selected).toBeNull();
    expect(published.at(-1)?.groundTracks).toHaveLength(0);
    expect(selected(panel)).toContain('unavailable');
  });

  it('labels a permitted future element epoch explicitly instead of showing an unknown age', async () => {
    const data = envelope();
    data.data!.items[0] = object('25544', 'ISS FUTURE EPOCH', 'stations', Date.now() + 7 * 3600_000);
    source.fetch.mockResolvedValue(data);
    const panel = await mount();
    expect(selected(panel)).toContain('7 hours ahead');
    expect(published.at(-1)?.selected?.noradId).toBe('25544');
  });
});
