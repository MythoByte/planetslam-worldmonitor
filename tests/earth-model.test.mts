import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEarthDataset, currentEarthWeather, ageEarthEnvelope, filterEarthEvents, relatedEarthNews, getSelectedEarthEventId, setSelectedEarthEventId } from '../src/services/earth.ts';
import type { EarthEvent, EarthEnvelope, EarthItems, EarthNewsItem, EarthWeatherItem, EarthSource } from '../src/types/earth.ts';
const now = Date.now();
const event = (patch: Partial<EarthEvent> = {}): EarthEvent => ({ id: 'synthetic-event', sourceId: 'synthetic', title: 'Synthetic flood',
  kind: 'flood', latitude: 10, longitude: 20, region: 'Europe', severity: 'moderate', status: 'Ongoing', mode: 'observed',
  observedAt: now - 1000, expiresAt: null, url: 'https://example.com/event', provider: 'Synthetic source', summary: 'Fixture only', ...patch });
const news = (patch: Partial<EarthNewsItem> = {}): EarthNewsItem => ({ id: 'synthetic-news', sourceId: 'synthetic', title: 'Synthetic regional flood reporting',
  url: 'https://example.com/story', summary: 'Fixture only', publisher: 'Synthetic publisher', publishedAt: now - 1000, kind: 'flood', region: 'Europe', official: false, ...patch });
const envelope = (patch: Partial<EarthEnvelope<EarthItems<EarthEvent>>> = {}): EarthEnvelope<EarthItems<EarthEvent>> => ({ dataset: 'events', status: 'fresh',
  provider: 'Synthetic', sourceUrl: 'https://example.com', coverage: 'Synthetic only', fetchedAt: now, observedAt: now - 1000, expiresAt: now + 60_000,
  data: { items: [event()] }, ...patch });

test('event filtering combines hazard, region, severity and time, and excludes expired alerts', () => {
  const events = [event(), event({ id: 'other-kind', kind: 'storm' }), event({ id: 'other-region', region: 'Asia' }),
    event({ id: 'other-severity', severity: 'severe' }), event({ id: 'old', observedAt: now - 25 * 3600_000 }), event({ id: 'expired', expiresAt: now })];
  assert.deepEqual(filterEarthEvents(events, { hazard: 'flood', region: 'Europe', severity: 'moderate', hours: 24 }, now).map(item => item.id), ['synthetic-event']);
  assert.ok(filterEarthEvents(events, {}, now).some(item => item.id === 'other-kind'));
  assert.equal(filterEarthEvents(events, { region: 'No coverage' }, now).length, 0);
});
test('related reporting prioritizes explicit event references, labels regional context, and rejects global category-only links', () => {
  const exact = news({ id: 'exact', region: 'Global', kind: 'other', relatedUrls: ['https://example.com/event'] });
  const context = news();
  const unrelated = news({ id: 'unrelated', region: 'Asia' });
  assert.deepEqual(relatedEarthNews(event(), [context, unrelated, exact]).map(row => [row.item.id, row.exact]), [['exact', true], ['synthetic-news', false]]);
  assert.deepEqual(relatedEarthNews(event({ region: 'Global' }), [news({ region: 'Global' })]), []);
  assert.deepEqual(relatedEarthNews(event({ region: 'Unknown' }), [news({ region: 'Unknown' })]), []);
});
test('cached snapshot expiry hides data without advancing original fetch or observation clocks', () => {
  const fresh = envelope();
  assert.equal(ageEarthEnvelope(fresh, now).status, 'fresh');
  const expired = ageEarthEnvelope(fresh, now + 60_000);
  assert.equal(expired.status, 'unavailable'); assert.equal(expired.data, null);
  assert.equal(expired.fetchedAt, now); assert.equal(expired.observedAt, now - 1000);
  assert.equal(fresh.status, 'fresh'); assert.equal(fresh.data!.items.length, 1);
  assert.equal(ageEarthEnvelope(envelope({ status: 'unavailable' }), now).data, null);
});
test('health children age independently and selection survives deferred panel creation', () => {
  const parent: EarthEnvelope<EarthItems<EarthEnvelope<unknown>>> = { ...envelope(), dataset: 'health', data: { items: [envelope({ expiresAt: now })] } };
  assert.equal(ageEarthEnvelope(parent, now).data!.items[0]!.status, 'unavailable');
  setSelectedEarthEventId('synthetic-deferred'); assert.equal(getSelectedEarthEventId(), 'synthetic-deferred');
  setSelectedEarthEventId('');
});


test('shared requests deduplicate concurrent consumers; failed refresh cannot serve a retained green cache', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let fail = false;
  globalThis.fetch = async () => {
    calls += 1;
    if (fail) return new Response('', { status: 503 });
    return Response.json(envelope({ dataset: 'rivers' }));
  };
  try {
    const [a, b] = await Promise.all([fetchEarthDataset('rivers'), fetchEarthDataset('rivers')]);
    assert.equal(calls, 1); assert.equal(a.status, 'fresh'); assert.deepEqual(a, b);
    fail = true;
    await assert.rejects(fetchEarthDataset('rivers', true), /temporarily unavailable/);
    assert.equal(calls, 2);
    await assert.rejects(fetchEarthDataset('rivers'), /temporarily unavailable/);
    assert.equal(calls, 3);
    fail = false;
    assert.equal((await fetchEarthDataset('rivers')).status, 'fresh');
    assert.equal(calls, 4);
  } finally { globalThis.fetch = original; }
});


test('mixed source expiry preserves healthy peers and ages source status without moving fetch clocks', () => {
  const source = (id: string, expiresAt: number, staleAt: number): EarthSource => ({ id, provider: 'Synthetic', status: 'fresh', fetchedAt: now - 1000, observedAt: now - 1000, expiresAt, staleAt, coverage: 'Fixture only' });
  const data = envelope({ expiresAt: now, data: { items: [event({ sourceId: 'expired' }), event({ id: 'healthy-event', sourceId: 'healthy' })],
    sources: [source('expired', now, now - 1000), source('healthy', now + 60_000, now + 1000)] } });
  const aged = ageEarthEnvelope(data, now);
  assert.equal(aged.status, 'stale'); assert.equal(aged.expiresAt, now + 60_000);
  assert.deepEqual(aged.data!.items.map(item => item.id), ['healthy-event']);
  assert.equal(aged.sources![0]!.status, 'unavailable'); assert.equal(aged.sources![1]!.status, 'fresh');
  assert.equal(ageEarthEnvelope(data, now + 2000).sources![1]!.status, 'stale');
  assert.equal(ageEarthEnvelope(data, now + 60_000).data, null);
  assert.equal(aged.fetchedAt, data.fetchedAt);
});
test('station readings expire individually even while another station keeps its source current', () => {
  const data = envelope({ dataset: 'airquality', data: { items: [event({ sourceId: 'station', observedAt: now - 2000 }), event({ id: 'recent', sourceId: 'station', observedAt: now - 500 })],
    sources: [{ id: 'station', provider: 'Synthetic', status: 'fresh', fetchedAt: now, observedAt: now - 500, expiresAt: now + 1000, observationMaxAgeMs: 1000, coverage: 'Fixture' }] } });
  assert.deepEqual(ageEarthEnvelope(data, now).data!.items.map(item => item.id), ['recent']);
});
test('weather conditions advance to the current model hour and never reuse an obsolete first forecast hour', () => {
  const hour = Math.floor(now / 3600_000) * 3600_000;
  const point = (time: number, temperatureC: number) => ({ time, temperatureC, windKmh: 10, precipitationMm: 0, symbol: 'clearsky_day' });
  const weather: EarthWeatherItem = { id: 'synthetic', sourceId: 'met-synthetic', name: 'Synthetic', latitude: 0, longitude: 0, region: 'Fixture', modelRunAt: hour - 4 * 3600_000,
    current: point(hour - 4 * 3600_000, 10), forecast: [point(hour - 4 * 3600_000, 10), point(hour, 20), point(hour + 3600_000, 21)], sourceUrl: 'https://example.com' };
  const projected = currentEarthWeather(weather, now);
  assert.equal(projected.current!.temperatureC, 20); assert.deepEqual(projected.forecast.map(item => item.temperatureC), [21]);
  assert.equal(currentEarthWeather(weather, hour + 3 * 3600_000).current, null);
  assert.equal(weather.current.temperatureC, 10);
});
