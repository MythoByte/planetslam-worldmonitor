import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEarthquakes, normalizeEonet, normalizeNws, normalizeGdacs, normalizeTsunami, normalizeMetWeather, normalizeRiver,
  normalizeEarthNews, fetchEarthSource } from '../scripts/_earth-providers.mjs';
import { EARTH_LOCATIONS, EARTH_GAUGES, validEarthData } from '../api/_earth-data.js';
const now = Date.now(), iso = new Date(now).toISOString();

test('earthquakes retain magnitude and depth without inventing severity from magnitude', () => {
  const raw = { type: 'FeatureCollection', metadata: { generated: now }, features: [{ id: 'synthetic', geometry: { coordinates: [-120, 40, 12] }, properties: {
    mag: 5, place: 'Synthetic quake', time: now, title: 'M5 Synthetic', url: 'https://earthquake.usgs.gov/synthetic', type: 'earthquake', status: 'reviewed' } }] };
  const out = normalizeEarthquakes(raw);
  assert.equal(out.data.items[0].depthKm, 12);
  assert.equal(out.data.items[0].severity, 'unknown');
  assert.equal(out.observedAt, now);
  assert.equal(validEarthData('usgs', out.data), true);
  assert.throws(() => normalizeEarthquakes({ features: [] }));
});

test('EONET selects newest valid point and retains unknown severity', () => {
  const out = normalizeEonet({ events: [{ id: 'synthetic', title: 'Synthetic wildfire', closed: null, categories: [{ id: 'wildfires' }],
    link: 'https://eonet.gsfc.nasa.gov/synthetic', sources: [], geometry: [{ type: 'Point', coordinates: [10, 20], date: new Date(now - 1000).toISOString() },
      { type: 'Point', coordinates: [11, 21], date: iso }] }] });
  assert.equal(out.data.items[0].longitude, 11);
  assert.equal(out.data.items[0].kind, 'wildfire');
  assert.equal(out.data.items[0].severity, 'unknown');
  assert.deepEqual(normalizeEonet({ events: [] }).data.items, []);
});

test('NWS keeps alerts lacking map geometry and removes expired or test alerts', () => {
  const p = { id: 'synthetic', '@id': 'https://api.weather.gov/alerts/synthetic', event: 'Flood Warning', sent: iso,
    expires: new Date(now + 3600_000).toISOString(), status: 'Actual', messageType: 'Alert', severity: 'Severe' };
  const out = normalizeNws({ type: 'FeatureCollection', updated: iso, features: [{ geometry: null, properties: p },
    { properties: { ...p, status: 'Test' } }, { properties: { ...p, expires: new Date(now - 1).toISOString() } }] }, now);
  assert.equal(out.data.items.length, 1);
  assert.equal(out.data.items[0].latitude, null);
  assert.equal(out.data.items[0].mode, 'warning');
});

test('GDACS keeps current impact assessments without misusing event end as alert expiry', () => {
  const out = normalizeGdacs(`<rss><channel><pubDate>${iso}</pubDate><item><title>Synthetic cyclone</title><link>http://www.gdacs.org/report.aspx?eventid=1</link>
    <pubDate>${iso}</pubDate><gdacs:iscurrent>true</gdacs:iscurrent><gdacs:eventtype>TC</gdacs:eventtype><gdacs:eventid>1</gdacs:eventid>
    <gdacs:todate>2020-01-01T00:00:00Z</gdacs:todate><gdacs:alertlevel>Orange</gdacs:alertlevel><geo:Point><geo:lat>10</geo:lat><geo:long>20</geo:long></geo:Point></item></channel></rss>`);
  assert.equal(out.data.items[0].mode, 'forecast');
  assert.equal(out.data.items[0].expiresAt, null);
  assert.equal(out.data.items[0].url.startsWith('https:'), true);
});

test('tsunami information statements never become warnings; old bulletins disappear', () => {
  const content = `<feed><updated>${iso}</updated><entry><id>synthetic</id><title>Synthetic earthquake</title><updated>${iso}</updated>
    <summary>Category: Information. There is NO tsunami danger from this earthquake.</summary><geo:lat>40</geo:lat><geo:long>-125</geo:long>
    <link rel="alternate" href="https://www.tsunami.gov/synthetic" /></entry></feed>`;
  const out = normalizeTsunami(content, now);
  assert.equal(out.data.items[0].mode, 'observed');
  assert.match(out.data.items[0].status, /Information bulletin/);
  assert.equal(normalizeTsunami(content, now + 25 * 3600_000).data.items.length, 0);
});

test('weather preserves model issue time and converts wind without inventing unavailable precipitation', () => {
  const out = normalizeMetWeather({ properties: { meta: { updated_at: iso }, timeseries: [{ time: iso,
    data: { instant: { details: { air_temperature: 12, wind_speed: 5 } } } }] } }, EARTH_LOCATIONS[0]);
  assert.equal(out.data.items[0].modelRunAt, now);
  assert.equal(out.data.items[0].current.windKmh, 18);
  assert.equal(out.data.items[0].current.precipitationMm, null);
  assert.equal(validEarthData('met-new-york', out.data), true);
});

test('river values retain provider units and thresholds, missing values are not treated as levels', () => {
  const raw = { lid: 'PTTP1', name: 'Synthetic river', status: { observed: { primary: 10, primaryUnit: 'ft', validTime: iso, floodCategory: 'no_flooding' } },
    flood: { categories: { minor: { stage: 20 }, major: { stage: -9999 } } } };
  const out = normalizeRiver(raw, EARTH_GAUGES[0]);
  assert.equal(out.data.items[0].thresholds.minor, 20);
  assert.equal(out.data.items[0].thresholds.major, null);
  assert.throws(() => normalizeRiver({ ...raw, status: { observed: { primary: -9999, validTime: iso } } }, EARTH_GAUGES[0]));
});

test('news retains attribution and official/reporting distinction while rejecting unsafe links and XML entities', () => {
  const content = `<rss><channel><item><title>Synthetic Japan earthquake &amp; update</title><link>https://example.org/synthetic</link><pubDate>${iso}</pubDate><description>Text</description></item></channel></rss>`;
  const official = normalizeEarthNews(content, 'news-nasa').data.items[0];
  assert.equal(official.official, true);
  assert.equal(official.kind, 'earthquake');
  assert.equal(official.region, 'Asia');
  assert.match(official.title, / & update/);
  assert.equal(normalizeEarthNews(content, 'news-guardian').data.items[0].summary, '');
  assert.throws(() => normalizeEarthNews(content.replace('https://example.org/synthetic', 'javascript:alert(1)'), 'news-nasa'));
  assert.throws(() => normalizeEarthNews('<!DOCTYPE a [<!ENTITY b SYSTEM "file:///etc/passwd">]><rss><channel/></rss>', 'news-nasa'));
});

test('weather requests stay bounded to configured locations with contact UA, timeout, no redirects', async () => {
  const calls = [];
  await assert.rejects(fetchEarthSource('met-new-york', { fetchFn: async (url, options) => { calls.push({ url, options }); return new Response('outage', { status: 503 }); } }));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /lat=40.71&lon=-74.01/);
  assert.match(calls[0].options.headers['User-Agent'], /planetslam.com/);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal);
});


test('malformed nonempty provider responses cannot be published as fresh empty feeds', () => {
  assert.throws(() => normalizeEonet({ events: [{ unexpected: true }] }), /Malformed EONET/);
  assert.throws(() => normalizeGdacs(`<rss><channel><pubDate>${iso}</pubDate><item><unexpected>true</unexpected></item></channel></rss>`, now), /Malformed GDACS/);
  assert.throws(() => normalizeNws({ type: 'FeatureCollection', updated: iso, features: [{ properties: { unexpected: true } }] }, now), /Malformed NWS/);
  assert.throws(() => normalizeTsunami('<feed><entry><unexpected>true</unexpected></entry></feed>', now), /Malformed NTWC/);
  assert.throws(() => normalizeTsunami('<rss><channel><title>Synthetic RSS</title></channel></rss>', now), /Expected NTWC/);
});

test('provider generation clocks reject stale successful fetches and preserve genuinely empty current feeds', () => {
  assert.throws(() => normalizeEarthquakes({ type: 'FeatureCollection', metadata: { generated: now - 2 * 3600_000 }, features: [] }, now), /generation/);
  assert.throws(() => normalizeNws({ type: 'FeatureCollection', updated: new Date(now - 3600_000).toISOString(), features: [] }, now), /generation/);
  assert.throws(() => normalizeGdacs('<rss><channel><pubDate>2020-01-01T00:00:00Z</pubDate></channel></rss>', now), /generation/);
  assert.deepEqual(normalizeEarthquakes({ type: 'FeatureCollection', metadata: { generated: now }, features: [] }, now).data.items, []);
  assert.deepEqual(normalizeNws({ type: 'FeatureCollection', updated: iso, features: [] }, now).data.items, []);
  assert.deepEqual(normalizeGdacs(`<rss><channel><pubDate>${iso}</pubDate></channel></rss>`, now).data.items, []);
  assert.deepEqual(normalizeTsunami('<feed><updated>2020-01-01T00:00:00Z</updated></feed>', now).data.items, []);
});


test('EONET polygon events remain listed without fabricated point coordinates', () => {
  const out = normalizeEonet({ events: [{ id: 'synthetic-polygon', title: 'Synthetic storm', closed: null, categories: [{ id: 'severeStorms' }],
    link: 'https://eonet.gsfc.nasa.gov/synthetic-polygon', geometry: [{ type: 'Polygon', date: iso, coordinates: [[[10, 20], [11, 20], [10, 21], [10, 20]]] }] }] });
  assert.equal(out.data.items.length, 1);
  assert.equal(out.data.items[0].latitude, null);
  assert.equal(out.data.items[0].longitude, null);
  assert.equal(out.data.items[0].kind, 'storm');
  assert.equal(validEarthData('eonet', out.data), true);
});

test('an actual NWS alert missing expiry cannot look like an empty successful alert feed', () => {
  assert.throws(() => normalizeNws({ type: 'FeatureCollection', updated: iso, features: [{ properties: { id: 'synthetic', status: 'Actual',
    event: 'Flood Warning', sent: iso, '@id': 'https://api.weather.gov/alerts/synthetic' } }] }, now), /No valid active NWS alerts/);
});

test('unclassified tsunami messages cannot assert there is no active warning', () => {
  const out = normalizeTsunami(`<feed><updated>${iso}</updated><entry><id>synthetic</id><title>Synthetic bulletin</title><updated>${iso}</updated><summary>Unrecognized provider content</summary></entry></feed>`, now);
  assert.match(out.data.items[0].status, /Unclassified/);
  assert.doesNotMatch(out.data.items[0].status, /no active warning|no threat/i);
});


test('reporting excludes unrelated general-environment headlines while preserving natural phenomena', () => {
  const item = title => `<item><title>${title}</title><link>https://example.org/${encodeURIComponent(title)}</link><pubDate>${iso}</pubDate></item>`;
  const out = normalizeEarthNews(`<rss><channel>${item('Synthetic plastic packaging chemical study')}${item('Synthetic glacier retreat')}${item('Synthetic flood warning')}</channel></rss>`, 'news-guardian');
  assert.deepEqual(out.data.items.map(row => row.title), ['Synthetic glacier retreat', 'Synthetic flood warning']);
  assert.deepEqual(normalizeEarthNews(`<rss><channel>${item('Synthetic plastic packaging chemical study')}</channel></rss>`, 'news-guardian').data.items, []);
});
