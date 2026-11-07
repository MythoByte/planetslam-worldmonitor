import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapContainer } from '@/components/MapContainer';

const shared = vi.hoisted(() => {
  let releaseGlobe: () => void = () => {};
  const globeGate = new Promise<void>(resolve => { releaseGlobe = resolve; });
  return { variant: 'earth', releaseGlobe, globeGate, globeConstruct: vi.fn(), fetchRadar: vi.fn(async () => undefined) };
});
vi.mock('@/config/variant', async (original) => ({
  ...await original<typeof import('@/config/variant')>(),
  get SITE_VARIANT() { return shared.variant; },
}));
vi.mock('@/services/weather-radar', () => ({ fetchWeatherRadarFrame: shared.fetchRadar }));
vi.mock('@/components/GlobeMap', async () => {
  await shared.globeGate;
  return { GlobeMap: class {
    constructor() { shared.globeConstruct(); }
    whenReady() { return Promise.resolve(); }
  } };
});

type DemandMap = {
  container: HTMLElement; destroyed: boolean; rendererInitToken: number;
  rendererDemandCleanup: (() => void) | null;
  useDeckGL: boolean; useGlobe: boolean; initialState: { layers: { weather: boolean } };
  globeTexturePreloadCleanup: (() => void) | null;
  waitForDeckRendererDemand(token: number): Promise<boolean>;
  prewarmWeatherRadar(token: number): void;
  prewarmGlobeTexture(token: number): void;
  createGlobeMap(token: number): Promise<void>;
};
const maps: DemandMap[] = [];
const observers: Array<{ callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
const idleCallbacks: IdleRequestCallback[] = [];
const idle = vi.fn((callback: IdleRequestCallback, _options?: IdleRequestOptions) => { idleCallbacks.push(callback); return idleCallbacks.length; });
const originalIdle = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback');
const originalCancel = Object.getOwnPropertyDescriptor(window, 'cancelIdleCallback');
const makeMap = (): DemandMap => {
  const container = document.createElement('div'); document.body.appendChild(container);
  const map = Object.assign(Object.create(MapContainer.prototype), {
    container, destroyed: false, rendererInitToken: 1, rendererDemandRequested: false,
    rendererDemandCleanup: null, releaseRendererDemand: null, useDeckGL: true, useGlobe: false,
    initialState: { layers: { weather: true } }, radarPrewarmGeneration: null,
    globeTexturePreloadCleanup: null, globeInitToken: 0, rehydrateActiveMap: vi.fn(),
    prepareRendererDom: vi.fn(), markRendererReady: vi.fn(),
  }) as DemandMap;
  maps.push(map); return map;
};
const show = () => observers[0]!.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

beforeEach(() => {
  vi.useFakeTimers(); shared.variant = 'earth'; shared.fetchRadar.mockClear(); idle.mockClear(); idleCallbacks.length = 0; observers.length = 0;
  Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: idle });
  Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: vi.fn() });
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn();
    constructor(public callback: IntersectionObserverCallback) { observers.push(this); }
    observe() {}
  });
});
afterEach(() => {
  for (const map of maps.splice(0)) { map.destroyed = true; map.rendererDemandCleanup?.(); map.globeTexturePreloadCleanup?.(); }
  vi.useRealTimers(); vi.unstubAllGlobals();
  if (originalIdle) Object.defineProperty(window, 'requestIdleCallback', originalIdle); else Reflect.deleteProperty(window, 'requestIdleCallback');
  if (originalCancel) Object.defineProperty(window, 'cancelIdleCallback', originalCancel); else Reflect.deleteProperty(window, 'cancelIdleCallback');
  document.body.replaceChildren();
});

describe('Earth renderer startup policy', () => {
  it('releases a visible Earth map after 200ms and a bounded idle slot, warming only its enabled radar', async () => {
    const map = makeMap(), ready = map.waitForDeckRendererDemand(1);
    show();
    await vi.advanceTimersByTimeAsync(199); expect(idle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(idle).toHaveBeenCalledOnce();
    expect(idle.mock.calls[0]![1]).toEqual({ timeout: 500 });
    idleCallbacks[0]!({ didTimeout: false, timeRemaining: () => 50 });
    await expect(ready).resolves.toBe(true);
    await vi.dynamicImportSettled();
    expect(shared.fetchRadar).toHaveBeenCalledOnce(); expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  });
  it('keeps the existing 3.5s/5s idle policy for other editions', async () => {
    shared.variant = 'full';
    const ready = makeMap().waitForDeckRendererDemand(1); show();
    await vi.advanceTimersByTimeAsync(3499); expect(idle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(idle.mock.calls[0]![1]).toEqual({ timeout: 5000 });
    idleCallbacks[0]!({ didTimeout: true, timeRemaining: () => 0 }); await expect(ready).resolves.toBe(true);
    expect(shared.fetchRadar).not.toHaveBeenCalled();
  });
  it('retains the 12s offscreen backstop without prematurely warming weather', async () => {
    let settled = false;
    const ready = makeMap().waitForDeckRendererDemand(1).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(11999); expect(settled).toBe(false); expect(shared.fetchRadar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await expect(ready).resolves.toBe(true);
  });
  it('honors direct demand and cancels a stale visible gate without later loading', async () => {
    const map = makeMap(), ready = map.waitForDeckRendererDemand(1); show();
    map.rendererInitToken += 1;
    await vi.advanceTimersByTimeAsync(200); idleCallbacks[0]!({ didTimeout: true, timeRemaining: () => 0 });
    await expect(ready).resolves.toBe(false); expect(shared.fetchRadar).not.toHaveBeenCalled();
    const next = map.waitForDeckRendererDemand(2); map.container.dispatchEvent(new Event('pointerdown'));
    await expect(next).resolves.toBe(true);
  });
  it('does not prewarm radar for disabled weather, SVG, globe or a superseded renderer', async () => {
    const map = makeMap(); map.initialState.layers.weather = false; map.prewarmWeatherRadar(1);
    map.initialState.layers.weather = true; map.useDeckGL = false; map.prewarmWeatherRadar(1);
    map.useDeckGL = true; map.useGlobe = true; map.prewarmWeatherRadar(1);
    map.useGlobe = false; map.prewarmWeatherRadar(0);
    await vi.dynamicImportSettled(); expect(shared.fetchRadar).not.toHaveBeenCalled();
  });
  it('does not begin a texture hint after an initial globe selection has already been superseded', async () => {
    const map = makeMap(); map.useGlobe = true; map.useDeckGL = false;
    map.prewarmGlobeTexture(1); map.rendererInitToken += 1; map.useGlobe = false;
    await vi.dynamicImportSettled();
    expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(0);
  });
  it('begins only the selected globe texture while the heavy globe import is still pending', async () => {
    vi.useRealTimers(); localStorage.setItem('wm-globe-texture', 'blue-marble');
    const map = makeMap(); map.useGlobe = true; map.useDeckGL = false;
    const creating = map.createGlobeMap(1);
    await vi.waitFor(() => expect(document.head.querySelector('link[rel="preload"][as="image"]')?.getAttribute('href')).toBe('/textures/earth-blue-marble.jpg'));
    const hint = document.head.querySelector<HTMLLinkElement>('link[rel="preload"][as="image"]')!;
    expect(hint.crossOrigin).toBe('anonymous'); expect(shared.globeConstruct).not.toHaveBeenCalled();
    shared.releaseGlobe(); await creating;
    expect(shared.globeConstruct).toHaveBeenCalledOnce(); expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(1);
    map.globeTexturePreloadCleanup?.(); expect(document.head.contains(hint)).toBe(false);
    localStorage.removeItem('wm-globe-texture');
  });
});
