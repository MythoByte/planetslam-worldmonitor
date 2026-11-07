import assert from 'node:assert/strict';
import test from 'node:test';
import { createWeatherRadarLoader, parseWeatherRadarManifest, WEATHER_RADAR_CACHE_KEY, WEATHER_RADAR_MANIFEST_URL, WEATHER_RADAR_MAX_AGE_MS } from '../src/services/weather-radar.ts';
const now = Math.floor(Date.now() / 1000) * 1000;
const seconds = (now - 10 * 60_000) / 1000;
const manifest = (patch: Record<string, unknown> = {}) => ({ generated: now / 1000, host: 'https://tilecache.rainviewer.com', radar: { past: [
  { time: seconds - 6600, path: `/v2/radar/${seconds - 6600}` }, { time: seconds, path: `/v2/radar/${seconds}` },
] }, ...patch });
function storage() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
  return { values, restore: () => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); } };
}
test('RainViewer selects latest actual past frame, retains its clock, and uses supported tile parameters', () => {
  const frame = parseWeatherRadarManifest(manifest(), now);
  assert.equal(frame.time, seconds * 1000); assert.equal(frame.fetchedAt, now); assert.equal(frame.maxZoom, 7);
  assert.equal(frame.tileUrl, `https://tilecache.rainviewer.com/v2/radar/${seconds}/512/{z}/{x}/{y}/2/1_1.png`);
  const reversed = manifest({ radar: { past: [{ time: seconds, path: `/v2/radar/${seconds}` }, { time: seconds - 600, path: `/v2/radar/${seconds - 600}` }] } });
  assert.equal(parseWeatherRadarManifest(reversed, now).time, seconds * 1000);
  const hashed = manifest({ radar: { past: [{ time: seconds, path: '/v2/radar/68285cec2f86' }] } });
  assert.match(parseWeatherRadarManifest(hashed, now).tileUrl, /\/68285cec2f86\/512\//);
});
test('manifest validation rejects malformed, unsafe, empty, future and stale metadata without accepting cloud or forecast frames', () => {
  for (const raw of [null, {}, manifest({ host: 'https://example.org' }), manifest({ host: 'http://tilecache.rainviewer.com' }),
    manifest({ host: 'https://user@tilecache.rainviewer.com' }), manifest({ host: 'https://tilecache.rainviewer.com:444' }),
    manifest({ generated: (now - WEATHER_RADAR_MAX_AGE_MS - 1000) / 1000 }), manifest({ generated: (now + 61_000) / 1000 }),
    manifest({ radar: { past: [] } }), manifest({ radar: { past: [{ time: seconds, path: '/redirect/unsafe' }] } }),
    manifest({ radar: { past: [{ time: seconds, path: '/v2/radar/../../unsafe' }] } }), manifest({ radar: { past: [{ time: seconds, path: '/v2/radar/hash?token=1' }] } }),
    manifest({ radar: { past: [{ time: (now + 61_000) / 1000, path: `/v2/radar/${(now + 61_000) / 1000}` }] } }),
    manifest({ radar: { past: [{ time: (now - WEATHER_RADAR_MAX_AGE_MS - 1000) / 1000, path: `/v2/radar/${(now - WEATHER_RADAR_MAX_AGE_MS - 1000) / 1000}` }] } }),
    manifest({ radar: { past: Array.from({ length: 49 }, () => ({ time: seconds, path: `/v2/radar/${seconds}` })) } }),
    manifest({ radar: { nowcast: [{ time: seconds, path: `/v2/radar/${seconds}` }] }, satellite: { infrared: [] } }),
  ]) assert.throws(() => parseWeatherRadarManifest(raw, now));
});
test('concurrent cold and forced consumers share one bounded request; a warm request reuses its fetched clock', async () => {
  const store = storage();
  try {
    let calls = 0, finish: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    let signal: AbortSignal | undefined;
    const loader = createWeatherRadarLoader({ now: () => now, fetchFn: async (url, init) => {
      calls++; assert.equal(url, WEATHER_RADAR_MANIFEST_URL); signal = init?.signal as AbortSignal; assert.equal(init?.redirect, 'error');
      await ready; return Response.json(manifest());
    } });
    assert.equal(calls, 0, 'module/loader construction performs no speculative network request');
    const a = loader.fetchWeatherRadarFrame(), b = loader.fetchWeatherRadarFrame(true);
    assert.equal(a, b); assert.equal(calls, 1); assert.equal(signal?.aborted, false); finish!();
    const result = await a;
    assert.deepEqual(await loader.fetchWeatherRadarFrame(), result); assert.equal(calls, 1);
    assert.equal(loader.getCachedWeatherRadarFrame()!.fetchedAt, now);
  } finally { store.restore(); }
});
test('cached frames survive reload, expire by observation age and cannot direct arbitrary tile requests', async () => {
  const store = storage();
  try {
    let at = now;
    const first = createWeatherRadarLoader({ now: () => at, fetchFn: async () => Response.json(manifest()) });
    const frame = await first.fetchWeatherRadarFrame();
    const reloaded = createWeatherRadarLoader({ now: () => at });
    assert.deepEqual(reloaded.getCachedWeatherRadarFrame(), frame);
    at = frame.time + WEATHER_RADAR_MAX_AGE_MS + 1;
    assert.equal(reloaded.getCachedWeatherRadarFrame(), null);
    assert.equal(store.values.has(WEATHER_RADAR_CACHE_KEY), false);
    for (const patch of [{ tileUrl: 'https://example.org/unsafe' }, { fetchedAt: now + 61_000 }, { time: now + 61_000 }, { maxZoom: 22 }, { version: 2 }]) {
      store.values.set(WEATHER_RADAR_CACHE_KEY, JSON.stringify({ version: 1, ...frame, ...patch }));
      assert.equal(createWeatherRadarLoader({ now: () => now }).getCachedWeatherRadarFrame(), null);
    }
  } finally { store.restore(); }
});
test('failed refresh leaves last-good clocks unchanged and clears pending state for an immediate retry', async () => {
  const store = storage();
  try {
    let at = now, fail = false, calls = 0;
    const loader = createWeatherRadarLoader({ now: () => at, fetchFn: async () => { calls++; return fail ? Response.json({}, { status: 503 }) : Response.json(manifest()); } });
    const frame = await loader.fetchWeatherRadarFrame();
    at += 61_000; fail = true;
    await assert.rejects(loader.fetchWeatherRadarFrame(), /unavailable/);
    assert.deepEqual(loader.getCachedWeatherRadarFrame(), frame);
    fail = false;
    assert.equal((await loader.fetchWeatherRadarFrame(true)).fetchedAt, at); assert.equal(calls, 3);
  } finally { store.restore(); }
});
test('requests time out and release shared pending state even if a transport fails to honor abort', async () => {
  const store = storage();
  try {
    let calls = 0, signal: AbortSignal | undefined;
    const loader = createWeatherRadarLoader({ now: () => now, timeoutMs: 5, fetchFn: async (_url, init) => {
      calls++; signal = init?.signal as AbortSignal;
      if (calls === 1) return new Promise<Response>(() => {});
      return Response.json(manifest());
    } });
    await assert.rejects(loader.fetchWeatherRadarFrame(), /timed out/); assert.equal(signal?.aborted, true);
    assert.equal((await loader.fetchWeatherRadarFrame()).time, seconds * 1000); assert.equal(calls, 2);
  } finally { store.restore(); }
});
test('oversized or malformed JSON responses cannot replace a cached usable frame', async () => {
  const store = storage();
  try {
    let response = Response.json(manifest());
    const loader = createWeatherRadarLoader({ now: () => now, fetchFn: async () => response });
    const frame = await loader.fetchWeatherRadarFrame();
    for (const invalid of [new Response('{invalid'), new Response('x'.repeat(128 * 1024 + 1)), Response.json({}, { headers: { 'Content-Length': String(128 * 1024 + 1) } })]) {
      response = invalid; await assert.rejects(loader.fetchWeatherRadarFrame(true)); assert.deepEqual(loader.getCachedWeatherRadarFrame(), frame);
    }
  } finally { store.restore(); }
});
test('unavailable browser storage does not prevent a successful in-memory frame', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw Error('Storage blocked'); } });
    const loader = createWeatherRadarLoader({ now: () => now, fetchFn: async () => Response.json(manifest()) });
    assert.equal(loader.getCachedWeatherRadarFrame(), null);
    const frame = await loader.fetchWeatherRadarFrame(); assert.deepEqual(loader.getCachedWeatherRadarFrame(), frame);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
