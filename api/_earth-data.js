// Shared, edge-safe Earth wire contract and per-provider freshness projection.
const MINUTE = 60_000;
export const EARTH_KINDS = ['earthquake', 'flood', 'wildfire', 'storm', 'volcano', 'tsunami', 'weather', 'other'];
export const EARTH_LOCATIONS = [
  ['new-york', 'New York', 40.71, -74.01, 'North America'],
  ['los-angeles', 'Los Angeles', 34.05, -118.24, 'North America'],
  ['vancouver', 'Vancouver', 49.28, -123.12, 'North America'],
  ['london', 'London', 51.51, -0.13, 'Europe'],
  ['oslo', 'Oslo', 59.91, 10.75, 'Europe'],
  ['tokyo', 'Tokyo', 35.68, 139.69, 'Asia'],
  ['manila', 'Manila', 14.60, 120.98, 'Asia'],
  ['delhi', 'Delhi', 28.61, 77.21, 'Asia'],
  ['sydney', 'Sydney', -33.87, 151.21, 'Oceania'],
  ['auckland', 'Auckland', -36.85, 174.76, 'Oceania'],
  ['sao-paulo', 'São Paulo', -23.55, -46.63, 'South America'],
  ['cape-town', 'Cape Town', -33.92, 18.42, 'Africa'],
].map(([id, name, latitude, longitude, region]) => ({ id, name, latitude, longitude, region }));
export const EARTH_GAUGES = [
  { id: 'PTTP1', name: 'Ohio River at Pittsburgh', latitude: 40.441, longitude: -80.015 },
  { id: 'EADM7', name: 'Mississippi River at St. Louis', latitude: 38.629, longitude: -90.179 },
  { id: 'MEMT1', name: 'Mississippi River at Memphis', latitude: 35.123, longitude: -90.075 },
];
export const EARTH_DATASETS = Object.freeze({
  earthquakes: { provider: 'USGS', sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php', coverage: 'USGS M2.5+ earthquakes reported in the past day; detection coverage varies by region.' },
  events: { provider: 'NASA EONET', sourceUrl: 'https://eonet.gsfc.nasa.gov/', coverage: 'Up to 300 open events curated by NASA EONET. Not a complete inventory or an official warning service.' },
  alerts: { provider: 'GDACS / NOAA NWS / NOAA Tsunami Warning Centers', sourceUrl: 'https://www.gdacs.org/', coverage: 'GDACS selected global hazards; NWS warnings cover the United States and territories; tsunami bulletins cover NOAA warning-center areas.' },
  weather: { provider: 'MET Norway', sourceUrl: 'https://api.met.no/', coverage: 'Modelled weather for 12 selected cities worldwide. Forecast values, not station observations. MET Norway, CC BY 4.0.' },
  airquality: { provider: 'OpenAQ / optional WAQI', sourceUrl: 'https://openaq.org/', coverage: 'Reuse of centrally seeded station measurements. Requires the existing OpenAQ/WAQI integration; unavailable stations are not inferred. PM2.5 is not evidence of a wildfire cause.' },
  rivers: { provider: 'NOAA National Water Prediction Service', sourceUrl: 'https://water.noaa.gov/', coverage: 'Three selected US river gauges; observed stage and provider flood thresholds. Not global river coverage.' },
  news: { provider: 'NASA Earth Observatory / NOAA NHC / The Guardian', sourceUrl: 'https://earthobservatory.nasa.gov/', coverage: 'Selected English-language Earth and environmental RSS feeds; topic and region tags are inferred from headlines.' },
});
const source = (dataset, provider, sourceUrl, intervalMs, maxAgeMs, coverage, extra = {}) => ({ dataset, provider, sourceUrl, intervalMs, maxAgeMs, coverage, ...extra });
export const EARTH_SOURCES = Object.freeze({
  'airquality-cache': source('airquality', 'OpenAQ / optional WAQI', 'https://openaq.org/', 60 * MINUTE, 3 * 60 * MINUTE, EARTH_DATASETS.airquality.coverage, { cacheKey: 'climate:air-quality:v1' }),
  usgs: source('earthquakes', 'USGS', EARTH_DATASETS.earthquakes.sourceUrl, 5 * MINUTE, 60 * MINUTE, EARTH_DATASETS.earthquakes.coverage),
  eonet: source('events', 'NASA EONET', 'https://eonet.gsfc.nasa.gov/docs/v3', 30 * MINUTE, 24 * 60 * MINUTE, EARTH_DATASETS.events.coverage),
  gdacs: source('alerts', 'GDACS', 'https://www.gdacs.org/', 15 * MINUTE, 3 * 60 * MINUTE, 'GDACS selected global earthquake, cyclone, flood, volcano, drought and wildfire events.'),
  nws: source('alerts', 'NOAA NWS', 'https://www.weather.gov/documentation/services-web-alerts', 5 * MINUTE, 30 * MINUTE, 'United States and territories; alerts without supplied geometry remain in the list but are not placed on the map.'),
  tsunami: source('alerts', 'NOAA National Tsunami Warning Center', 'https://www.tsunami.gov/', 5 * MINUTE, 30 * MINUTE, 'NOAA NTWC bulletins. Informational/no-threat bulletins are labelled informational, not warnings.'),
  'news-nasa': source('news', 'NASA Earth Observatory', 'https://earthobservatory.nasa.gov/', 30 * MINUTE, 12 * 60 * MINUTE, 'NASA Earth Observatory articles.', { official: true }),
  'news-nhc': source('news', 'NOAA National Hurricane Center', 'https://www.nhc.noaa.gov/', 15 * MINUTE, 3 * 60 * MINUTE, 'Atlantic tropical cyclone bulletins; not worldwide cyclone coverage.', { official: true }),
  'news-guardian': source('news', 'The Guardian Environment', 'https://www.theguardian.com/environment', 30 * MINUTE, 6 * 60 * MINUTE, 'Environment reporting; headline and source links only.', { official: false }),
  ...Object.fromEntries(EARTH_LOCATIONS.map(location => [`met-${location.id}`, source('weather', 'MET Norway', 'https://api.met.no/', 60 * MINUTE, 6 * 60 * MINUTE, `${location.name}: model forecast, CC BY 4.0.`, { location })])),
  ...Object.fromEntries(EARTH_GAUGES.map(gauge => [`river-${gauge.id}`, source('rivers', 'NOAA NWPS', 'https://water.noaa.gov/', 15 * MINUTE, 2 * 60 * MINUTE, `${gauge.name}, United States.`, { gauge })])),
});
export const earthKey = sourceId => {
  const config = EARTH_SOURCES[sourceId];
  if (!config) throw new Error('Unknown Earth source');
  return config.cacheKey || `earth:${config.dataset}:${sourceId}:v1`;
};
const finiteTime = value => Number.isFinite(value) && value > 0 && value <= 8_640_000_000_000_000;
const safeUrl = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
};
const coordinate = (value, limit) => value === null || Number.isFinite(value) && Math.abs(value) <= limit;
const text = (value, max = 5000) => typeof value === 'string' && value.length > 0 && value.length <= max;
const measurement = value => value === null || Number.isFinite(value);
export function validEarthData(sourceId, data) {
  const config = EARTH_SOURCES[sourceId];
  if (!config || !data || !Array.isArray(data.items) || data.items.length > 2500) return false;
  return data.items.every(item => {
    if (!item || !text(item.id, 1000) || item.sourceId !== sourceId) return false;
    if (config.dataset === 'news') return text(item.title) && safeUrl(item.url) && text(item.publisher, 200)
      && finiteTime(item.publishedAt) && EARTH_KINDS.includes(item.kind) && text(item.region, 200) && typeof item.official === 'boolean';
    if (config.dataset === 'weather') return text(item.name, 200) && coordinate(item.latitude, 90) && coordinate(item.longitude, 180)
      && finiteTime(item.modelRunAt) && safeUrl(item.sourceUrl) && item.current && finiteTime(item.current.time)
      && Number.isFinite(item.current.temperatureC) && Array.isArray(item.forecast) && item.forecast.length <= 48
      && item.forecast.every(point => finiteTime(point.time) && Number.isFinite(point.temperatureC) && measurement(point.windKmh) && measurement(point.precipitationMm));
    if (config.dataset === 'airquality') return text(item.name, 200) && finiteTime(item.observedAt) && Number.isFinite(item.aqi) && item.aqi >= 0 && item.aqi <= 500
      && Number.isFinite(item.pm25) && item.pm25 >= 0 && coordinate(item.latitude, 90) && coordinate(item.longitude, 180) && safeUrl(item.sourceUrl);
    if (config.dataset === 'rivers') return text(item.name, 200) && finiteTime(item.observedAt) && Number.isFinite(item.stage)
      && text(item.unit, 50) && safeUrl(item.sourceUrl) && coordinate(item.latitude, 90) && coordinate(item.longitude, 180)
      && ['action', 'minor', 'moderate', 'major'].every(key => measurement(item.thresholds?.[key]));
    return text(item.title) && EARTH_KINDS.includes(item.kind) && coordinate(item.latitude, 90) && coordinate(item.longitude, 180)
      && text(item.region, 200) && ['extreme', 'severe', 'moderate', 'minor', 'unknown'].includes(item.severity)
      && ['observed', 'forecast', 'warning'].includes(item.mode) && text(item.status, 200)
      && finiteTime(item.observedAt) && (item.expiresAt === null || finiteTime(item.expiresAt)) && safeUrl(item.url) && text(item.provider, 200);
  });
}
export function projectEarthSource(sourceId, snapshot, now = Date.now()) {
  const config = EARTH_SOURCES[sourceId];
  if (!config) throw new Error('Unknown Earth source');
  if (config.dataset === 'airquality') snapshot = normalizeAirQualityCache(snapshot);
  const valid = snapshot?.sourceId === sourceId && snapshot.dataset === config.dataset && validEarthData(sourceId, snapshot.data)
    && finiteTime(snapshot.fetchedAt) && snapshot.fetchedAt <= now + MINUTE;
  const fetchedAt = valid ? snapshot.fetchedAt : null;
  const observedAt = valid && finiteTime(snapshot.observedAt) ? snapshot.observedAt : null;
  const observationMaxAgeMs = config.dataset === 'weather' ? 12 * 60 * MINUTE
    : ['rivers', 'airquality'].includes(config.dataset) ? config.maxAgeMs : null;
  const expiresAt = fetchedAt ? Math.min(fetchedAt + config.maxAgeMs, observationMaxAgeMs !== null && observedAt
    ? observedAt + observationMaxAgeMs : Infinity) : null;
  const staleAt = fetchedAt ? Math.min(fetchedAt + config.intervalMs * 2, expiresAt) : null;
  const contentExpired = observationMaxAgeMs !== null && (!observedAt || observedAt > now + MINUTE);
  const status = !valid || now >= expiresAt || contentExpired ? 'unavailable'
    : now >= staleAt ? 'stale' : 'fresh';
  const items = status === 'unavailable' ? [] : snapshot.data.items.filter(item => {
    if (config.dataset === 'alerts') return item.expiresAt === null || item.expiresAt > now;
    if (config.dataset === 'earthquakes') return now - item.observedAt <= 24 * 60 * MINUTE;
    if (['rivers', 'airquality'].includes(config.dataset)) return now - item.observedAt <= config.maxAgeMs && item.observedAt <= now + MINUTE;
    return true;
  });
  return { id: sourceId, provider: config.provider, sourceUrl: config.sourceUrl, coverage: config.coverage,
    status, fetchedAt, observedAt, staleAt, expiresAt, observationMaxAgeMs,
    ...(status === 'unavailable' ? { message: 'Current source data unavailable.' } : status === 'stale' ? { message: 'Source refresh delayed; last known data.' } : {}), items };
}
export function earthEnvelope(dataset, snapshots = {}, now = Date.now()) {
  const config = EARTH_DATASETS[dataset];
  if (!config) throw new Error('Unknown Earth dataset');
  const sources = Object.entries(EARTH_SOURCES).filter(([, entry]) => entry.dataset === dataset)
    .map(([id]) => projectEarthSource(id, snapshots[id], now));
  const available = sources.filter(entry => entry.status !== 'unavailable');
  const status = !available.length ? 'unavailable' : sources.every(entry => entry.status === 'fresh') ? 'fresh' : 'stale';
  const newest = field => Math.max(0, ...available.map(entry => entry[field] || 0)) || null;
  let items = available.flatMap(entry => entry.items);
  if (dataset === 'news') {
    const groups = new Map();
    for (const item of items.sort((a, b) => b.publishedAt - a.publishedAt)) {
      const url = new URL(item.url); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^utm_|^fbclid$/.test(key)) url.searchParams.delete(key);
      const title = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const key = `${title}|${new Date(item.publishedAt).toISOString().slice(0, 10)}`;
      const prior = [...groups.values()].find(row => row.url === url.href) || groups.get(key);
      if (prior) { prior.relatedUrls = [...new Set([...(prior.relatedUrls || []), item.url])]; continue; }
      groups.set(key, { ...item, url: url.href, relatedUrls: [] });
    }
    items = [...groups.values()].slice(0, 100);
  } else if (['earthquakes', 'events', 'alerts'].includes(dataset)) items.sort((a, b) => b.observedAt - a.observedAt);
  return { dataset, status, provider: config.provider, sourceUrl: config.sourceUrl, coverage: config.coverage,
    fetchedAt: newest('fetchedAt'), observedAt: newest('observedAt'), expiresAt: available.length ? Math.min(...available.map(row => row.expiresAt)) : null,
    ...(status === 'unavailable' ? { message: 'Current data unavailable. Check provider status and configuration.' }
      : status === 'stale' ? { message: 'Some sources are delayed or unavailable; inspect source status.' } : {}),
    data: { items, sources: sources.map(({ items: _items, ...meta }) => meta) } };
}

/** Adapt the existing station cache without triggering a second provider ingestion. */
export function normalizeAirQualityCache(raw) {
  const fetchedAt = raw?.fetched_at ?? raw?.fetchedAt;
  if (!finiteTime(fetchedAt) || !Array.isArray(raw?.stations)) return null;
  const items = raw.stations.flatMap((row, index) => {
    const observedAt = row.measured_at ?? row.measuredAt;
    if (typeof row.city !== 'string' || !finiteTime(observedAt) || !Number.isFinite(row.pm25) || row.pm25 < 0
      || !Number.isFinite(row.aqi) || !Number.isFinite(row.lat) || Math.abs(row.lat) > 90 || !Number.isFinite(row.lng) || Math.abs(row.lng) > 180) return [];
    const countryCode = String(row.country_code ?? row.countryCode ?? '').slice(0, 10);
    return [{ id: `aq-${index}-${row.lat}-${row.lng}`, sourceId: 'airquality-cache', name: row.city.slice(0, 200), countryCode,
      latitude: row.lat, longitude: row.lng, region: earthRegion(row.lat, row.lng), observedAt, pm25: row.pm25,
      aqi: Math.max(0, Math.min(500, Math.round(row.aqi))), riskLevel: String(row.risk_level ?? row.riskLevel ?? 'Unknown').slice(0, 100),
      provider: String(row.source || 'OpenAQ').slice(0, 200), sourceUrl: /waqi/i.test(row.source || '') ? 'https://waqi.info/' : 'https://explore.openaq.org/' }];
  });
  return { sourceId: 'airquality-cache', dataset: 'airquality', fetchedAt, observedAt: Math.max(0, ...items.map(item => item.observedAt)) || null, data: { items: items.slice(0, 2500) } };
}
/** Broad geographic browsing groups, not reverse-geocoded administrative borders. */
export function earthRegion(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Global';
  if (latitude < -60) return 'Antarctica';
  if (longitude < -30) return latitude < 13 && longitude > -85 ? 'South America' : 'North America';
  if (longitude < 55 && latitude < 36 && latitude > -40 && longitude > -20) return 'Africa';
  if (longitude < 60 && latitude >= 36) return 'Europe';
  if (latitude < -10 && longitude > 110) return 'Oceania';
  return 'Asia';
}
