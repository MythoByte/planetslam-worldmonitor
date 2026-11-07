import { safeStorageGet, safeStorageSet, safeStorageRemove } from '@/utils/safe-storage';

/** RainViewer public historical precipitation radar; not satellite cloud imagery. */
export interface WeatherRadarFrame {
  readonly time: number;
  readonly fetchedAt: number;
  readonly tileUrl: string;
  readonly maxZoom: 7;
}
export const WEATHER_RADAR_MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const WEATHER_RADAR_CACHE_KEY = 'worldmonitor-weather-radar-v1';
export const WEATHER_RADAR_MAX_AGE_MS = 45 * 60_000;
const REFRESH_CACHE_MS = 60_000;
const MAX_MANIFEST_BYTES = 128 * 1024;
const TILE_HOST = 'https://tilecache.rainviewer.com';
const FUTURE_TOLERANCE_MS = 60_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const usableTime = (value: unknown, now: number): value is number => timestamp(value) && value <= now + FUTURE_TOLERANCE_MS && now - value <= WEATHER_RADAR_MAX_AGE_MS;
const validPath = (value: unknown): value is string => typeof value === 'string' && /^\/v2\/radar\/[A-Za-z0-9_-]{1,128}$/.test(value);
const tileUrl = (path: string): string => `${TILE_HOST}${path}/512/{z}/{x}/{y}/2/1_1.png`;
const validTileUrl = (value: unknown): value is string => typeof value === 'string'
  && /^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/[A-Za-z0-9_-]{1,128}\/512\/\{z\}\/\{x\}\/\{y\}\/2\/1_1\.png$/.test(value);

function storedFrame(value: unknown, now: number): WeatherRadarFrame | null {
  if (!object(value) || value.version !== 1 || !usableTime(value.time, now) || !usableTime(value.fetchedAt, now)
    || value.maxZoom !== 7 || value.time % 1000 !== 0 || !validTileUrl(value.tileUrl)) return null;
  return { time: value.time, fetchedAt: value.fetchedAt, tileUrl: value.tileUrl, maxZoom: 7 };
}

export function parseWeatherRadarManifest(value: unknown, now = Date.now()): WeatherRadarFrame {
  if (!object(value) || value.host !== TILE_HOST || !timestamp(value.generated) || !usableTime(value.generated * 1000, now)
    || !object(value.radar) || !Array.isArray(value.radar.past) || !value.radar.past.length || value.radar.past.length > 48) {
    throw new Error('Weather radar metadata is unavailable or expired');
  }
  const frames = value.radar.past;
  if (!frames.every(frame => object(frame) && timestamp(frame.time) && frame.time * 1000 <= now + FUTURE_TOLERANCE_MS
    && validPath(frame.path))) throw new Error('Invalid weather radar frame');
  const latest = frames.reduce((chosen, frame) => frame.time > chosen.time ? frame : chosen);
  const seconds = latest.time as number;
  if (!usableTime(seconds * 1000, now)) throw new Error('Weather radar frame has expired');
  return { time: seconds * 1000, fetchedAt: now, tileUrl: tileUrl(latest.path as string), maxZoom: 7 };
}

interface WeatherRadarLoaderOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** Isolated loader state also makes concurrency, storage and failure behavior testable. */
export function createWeatherRadarLoader({ fetchFn = (...args) => globalThis.fetch(...args), now = Date.now, timeoutMs = 8000 }: WeatherRadarLoaderOptions = {}) {
  let lastGood: WeatherRadarFrame | null = null;
  let pending: Promise<WeatherRadarFrame> | null = null;
  const getCached = (at = now()): WeatherRadarFrame | null => {
    if (lastGood && usableTime(lastGood.time, at) && usableTime(lastGood.fetchedAt, at)) return { ...lastGood };
    lastGood = null;
    const text = safeStorageGet(WEATHER_RADAR_CACHE_KEY);
    if (!text) return null;
    try { lastGood = text.length <= 1024 ? storedFrame(JSON.parse(text), at) : null; } catch { /* ignore invalid cached metadata */ }
    if (!lastGood) safeStorageRemove(WEATHER_RADAR_CACHE_KEY);
    return lastGood ? { ...lastGood } : null;
  };
  const request = async (): Promise<WeatherRadarFrame> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Weather radar request timed out')); }, timeoutMs);
      });
      const work = (async () => {
        const response = await fetchFn(WEATHER_RADAR_MANIFEST_URL, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Weather radar provider is unavailable');
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) throw new Error('Weather radar metadata is too large');
        if (!response.body) throw new Error('Weather radar metadata is empty');
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let content = '', bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_MANIFEST_BYTES) throw new Error('Weather radar metadata is too large');
          content += decoder.decode(chunk.value, { stream: true });
        }
        content += decoder.decode();
        if (controller.signal.aborted) throw new Error('Weather radar request timed out');
        return parseWeatherRadarManifest(JSON.parse(content), now());
      })();
      const frame = await Promise.race([work, deadline]);
      lastGood = frame;
      safeStorageSet(WEATHER_RADAR_CACHE_KEY, JSON.stringify({ version: 1, ...frame }));
      return { ...frame };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
  };
  const fetchFrame = (force = false): Promise<WeatherRadarFrame> => {
    if (pending) return pending;
    const cached = getCached();
    if (!force && cached && now() - cached.fetchedAt < REFRESH_CACHE_MS) return Promise.resolve(cached);
    const active = request().finally(() => { if (pending === active) pending = null; });
    pending = active;
    return active;
  };
  return { getCachedWeatherRadarFrame: getCached, fetchWeatherRadarFrame: fetchFrame };
}

const sharedLoader = createWeatherRadarLoader();
/** Retains last-good frame clocks. Consumers must label it as cached while refreshing. */
export const getCachedWeatherRadarFrame = sharedLoader.getCachedWeatherRadarFrame;
/** One bounded shared request; a consumer leaving cannot abort another map's request. */
export const fetchWeatherRadarFrame = sharedLoader.fetchWeatherRadarFrame;
