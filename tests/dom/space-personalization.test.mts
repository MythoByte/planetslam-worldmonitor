import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSpacePreferences, normalizeSpacePreferences, setSpaceObserver, toggleSpaceWatch, subscribeSpacePreferences } from '@/services/space-personalization';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('Local Space personalization', () => {
  it('rejects malformed coordinates, settings, identifiers, and oversized watchlists', () => {
    for (const raw of [null, [], 'location', { observer: { latitude: 200, longitude: 0, altitudeM: 0 } }, { observer: { latitude: '12', longitude: 1, altitudeM: 0 } }]) {
      expect(normalizeSpacePreferences(raw).observer).toBeNull();
    }
    const preferences = normalizeSpacePreferences({ horizonHours: 1000,
      satelliteWatchlist: ['25544', '25544', '<script>', 2, ...Array.from({ length: 20 }, (_, i) => String(i + 100001))],
      launchWatchlist: ['launch-1', 'javascript:alert(1)', 'launch-1'], missionWatchlist: ['22', '../secret'],
    });
    expect(preferences.horizonHours).toBe(24);
    expect(preferences.satelliteWatchlist).toHaveLength(10);
    expect(preferences.satelliteWatchlist[0]).toBe('25544');
    expect(preferences.launchWatchlist).toEqual(['launch-1']);
    expect(preferences.missionWatchlist).toEqual(['22']);
  });

  it('stores coordinates locally without network or automatic location access', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const listener = vi.fn(); const unsubscribe = subscribeSpacePreferences(listener);
    expect(setSpaceObserver({ latitude: 45, longitude: -75, altitudeM: 90 })).toBe(true);
    expect(getSpacePreferences().observer).toEqual({ latitude: 45, longitude: -75, altitudeM: 90 });
    expect(listener).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(setSpaceObserver({ latitude: NaN, longitude: 0, altitudeM: 0 })).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(setSpaceObserver(null)).toBe(true); expect(getSpacePreferences().observer).toBeNull();
    unsubscribe(); toggleSpaceWatch('satellite', '25544'); expect(listener).toHaveBeenCalledTimes(2);
  });

  it('enforces ten watches per kind and allows removal while the list is full', () => {
    for (const kind of ['satellite', 'launch', 'mission'] as const) {
      for (let i = 1; i <= 10; i++) expect(toggleSpaceWatch(kind, String(i))).toBe(true);
      expect(toggleSpaceWatch(kind, '11')).toBe(false);
      expect(toggleSpaceWatch(kind, '1')).toBe(false);
      expect(toggleSpaceWatch(kind, '11')).toBe(true);
    }
    expect(getSpacePreferences().satelliteWatchlist).not.toContain('1');
    expect(getSpacePreferences().satelliteWatchlist).toContain('11');
  });

  it('keeps explicit choices usable when browser storage is null', () => {
    setSpaceObserver(null);
    vi.stubGlobal('localStorage', null);
    try {
      expect(setSpaceObserver({ latitude: 12, longitude: 34, altitudeM: 0 })).toBe(true);
      expect(getSpacePreferences().observer).toEqual({ latitude: 12, longitude: 34, altitudeM: 0 });
      expect(toggleSpaceWatch('satellite', '25544')).toBe(true);
      expect(getSpacePreferences().satelliteWatchlist).toContain('25544');
    } finally {
      vi.unstubAllGlobals();
      setSpaceObserver(null);
    }
  });
});
