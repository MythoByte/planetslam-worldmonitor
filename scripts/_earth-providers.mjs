import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { decodeHtmlEntities } from './_html-entities.mjs';
import { EARTH_SOURCES, earthRegion } from '../api/_earth-data.js';

const UA = 'PlanetSlam-Earth/1.0 (+https://planetslam.com; https://github.com/MythoByte/planetslam-worldmonitor)';
const HOUR = 3_600_000;
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false,
  stopNodes: ['*.description', '*.summary', '*.content:encoded', '*.content'] });
const array = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const string = value => typeof value === 'object' && value ? value['#text'] || '' : String(value ?? '');
const text = (value, max = 1800) => decodeHtmlEntities(string(value)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const number = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const time = value => typeof value === 'number' ? (Number.isFinite(value) && value > 0 ? value : null) : Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const newest = values => Math.max(0, ...values.filter(Number.isFinite)) || null;
const validCoordinates = coordinates => Array.isArray(coordinates) && number(coordinates[0]) !== null && number(coordinates[1]) !== null
  && Math.abs(Number(coordinates[0])) <= 180 && Math.abs(Number(coordinates[1])) <= 90;
function https(value) {
  try {
    const url = new URL(decodeHtmlEntities(string(value)));
    // Known public providers still include legacy HTTP links in their RSS.
    if (url.protocol === 'http:' && /(^|\.)(gdacs\.org|usgs\.gov|noaa\.gov|nasa\.gov)$/.test(url.hostname)) url.protocol = 'https:';
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function requiredArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label} response`);
  return value;
}
function result(items, rows, observedAt) {
  if (rows.length && !items.length) throw new Error('No valid provider records');
  return { data: { items }, observedAt: observedAt ?? newest(items.map(item => item.observedAt ?? item.publishedAt ?? item.modelRunAt)) };
}
async function providerText(url, fetchFn = (...args) => globalThis.fetch(...args)) {
  const response = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/json,application/geo+json,application/atom+xml,application/rss+xml,application/xml;q=0.9' }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const content = await response.text();
  if (content.length > 5_000_000) throw new Error('Provider response too large');
  return content;
}
const json = async (url, fetchFn) => JSON.parse(await providerText(url, fetchFn));
function xml(content) {
  if (/<!DOCTYPE|<!ENTITY/i.test(content) || XMLValidator.validate(content) !== true) throw new Error('Invalid provider XML');
  const raw = parser.parse(content);
  if (!raw?.rss?.channel && !raw?.feed) throw new Error('Expected RSS or Atom feed');
  return raw;
}
export function classifyEarthKind(value) {
  if (/tsunami/i.test(value)) return 'tsunami';
  if (/earthquake|seismic|aftershock/i.test(value)) return 'earthquake';
  if (/flood|inundat|storm surge/i.test(value)) return 'flood';
  if (/wildfire|forest fire|bushfire|smoke|fire weather/i.test(value)) return 'wildfire';
  if (/volcan|eruption|lava|ash cloud/i.test(value)) return 'volcano';
  if (/cyclone|hurricane|typhoon|tornado|storm|lightning|hail|tropical weather/i.test(value)) return 'storm';
  if (/weather|heat|cold|snow|rain|drought|wind|freeze|frost|blizzard/i.test(value)) return 'weather';
  return 'other';
}
function newsRegion(value) {
  if (/\b(US|USA|United States|Canada|Mexico|California|Florida|Alaska|Hawaii)\b/i.test(value)) return 'North America';
  if (/\b(Brazil|Argentina|Chile|Peru|Colombia|Amazon)\b/i.test(value)) return 'South America';
  if (/\b(Europe|UK|Britain|England|Scotland|London|France|Spain|Italy|Germany|Greece|Norway|Iceland)\b/i.test(value)) return 'Europe';
  if (/\b(Africa|Kenya|Sudan|Congo|Nigeria|Morocco|Egypt)\b/i.test(value)) return 'Africa';
  if (/\b(Asia|Japan|China|India|Pakistan|Philippines|Taiwan|Bangladesh|Indonesia|Thailand|Vietnam)\b/i.test(value)) return 'Asia';
  if (/\b(Australia|New Zealand|Pacific Islands|Fiji)\b/i.test(value)) return 'Oceania';
  return 'Global';
}
export function normalizeEarthquakes(raw, now = Date.now()) {
  const rows = requiredArray(raw?.features, 'USGS');
  if (raw.type !== 'FeatureCollection') throw new Error('Invalid USGS collection');
  const generatedAt = time(raw.metadata?.generated);
  if (!generatedAt || generatedAt > now + 60_000 || now - generatedAt > HOUR) throw new Error('USGS feed generation is unavailable or delayed');
  const items = rows.flatMap(row => {
    const p = row.properties || {}, coords = row.geometry?.coordinates;
    const observedAt = time(p.time), url = https(p.url), magnitude = number(p.mag);
    if (!row.id || !observedAt || !url || !validCoordinates(coords) || magnitude === null || p.type !== 'earthquake') return [];
    const [longitude, latitude] = coords.map(Number);
    return [{ id: `usgs:${row.id}`, sourceId: 'usgs', title: text(p.title || `M ${magnitude} · ${p.place}`),
      kind: 'earthquake', latitude, longitude, region: earthRegion(latitude, longitude),
      severity: ({ green: 'minor', yellow: 'moderate', orange: 'severe', red: 'extreme' })[p.alert] || 'unknown',
      status: text(p.status || 'Reported'), mode: 'observed', observedAt, expiresAt: null, url, provider: 'USGS',
      summary: text(p.place || ''), magnitude, depthKm: number(coords[2]) }];
  });
  return result(items, rows);
}
export function normalizeEonet(raw) {
  const rows = requiredArray(raw?.events, 'EONET');
  if (rows.length && !rows.some(row => row && row.id && row.title && Array.isArray(row.geometry))) throw new Error('Malformed EONET event records');
  const items = rows.flatMap(row => {
    if (row.closed) return [];
    const geometries = array(row.geometry).filter(g => g && time(g.date) && (g.type === 'Point' && validCoordinates(g.coordinates)
      || g.type === 'Polygon' && Array.isArray(g.coordinates?.[0]) && g.coordinates[0].length > 2 && g.coordinates[0].every(validCoordinates)))
      .sort((a, b) => time(b.date) - time(a.date));
    const latestGeometry = geometries[0], point = latestGeometry?.type === 'Point' ? latestGeometry : null;
    const url = array(row.sources).map(s => https(s.url)).find(Boolean) || https(row.link);
    if (!row.id || !row.title || !latestGeometry || !url) return [];
    const [longitude, latitude] = point ? point.coordinates.map(Number) : [null, null];
    return [{ id: `eonet:${row.id}`, sourceId: 'eonet', title: text(row.title), kind: classifyEarthKind(array(row.categories).map(c => `${c.id} ${c.title}`).join(' ')),
      latitude, longitude, region: earthRegion(latitude, longitude), severity: 'unknown', status: 'Open in NASA EONET', mode: 'observed',
      observedAt: time(latestGeometry.date), expiresAt: null, url, provider: 'NASA EONET', summary: text(row.description || '') }];
  });
  // Polygon-only events remain in the list without an invented point marker.
  if (rows.length && !items.length && rows.some(row => !row.closed)) throw new Error('No valid EONET records');
  return { data: { items }, observedAt: newest(items.map(item => item.observedAt)) };
}
export function normalizeGdacs(content, now = Date.now()) {
  const raw = xml(content);
  if (!raw.rss?.channel) throw new Error('Expected GDACS RSS feed');
  const generatedAt = time(raw.rss.channel.pubDate);
  if (!generatedAt || generatedAt > now + 60_000 || now - generatedAt > 3 * HOUR) throw new Error('GDACS feed generation is unavailable or delayed');
  const rows = array(raw.rss.channel.item);
  if (rows.length && !rows.some(row => row && ['true', 'false'].includes(string(row['gdacs:iscurrent']).toLowerCase()) && row['gdacs:eventid'] && row['gdacs:eventtype'])) throw new Error('Malformed GDACS records');
  const items = rows.flatMap(row => {
    if (string(row['gdacs:iscurrent']).toLowerCase() !== 'true') return [];
    const latitude = number(row['geo:Point']?.['geo:lat']), longitude = number(row['geo:Point']?.['geo:long']);
    const observedAt = time(row['gdacs:datemodified'] || row.pubDate), url = https(row.link);
    if (!url || !row.title || !observedAt || latitude === null || longitude === null || !validCoordinates([longitude, latitude])) return [];
    const code = string(row['gdacs:eventtype']), level = text(row['gdacs:alertlevel']);
    return [{ id: `gdacs:${code}:${text(row['gdacs:eventid'])}`, sourceId: 'gdacs', title: text(row.title),
      kind: ({ EQ: 'earthquake', TC: 'storm', FL: 'flood', VO: 'volcano', WF: 'wildfire', DR: 'weather' })[code] || 'other',
      latitude, longitude, region: earthRegion(latitude, longitude), severity: ({ Red: 'severe', Orange: 'moderate', Green: 'minor' })[level] || 'unknown',
      status: `${level || 'Unknown'} GDACS impact estimate`, mode: code === 'TC' ? 'forecast' : 'observed', observedAt,
      // GDACS todate is an event period, NOT the expiry of its current impact assessment.
      expiresAt: null, url, provider: 'GDACS', summary: text(row.description) }];
  });
  if (rows.length && !items.length && rows.some(row => string(row['gdacs:iscurrent']).toLowerCase() === 'true')) throw new Error('No valid current GDACS records');
  return { data: { items }, observedAt: newest(items.map(item => item.observedAt)) };
}
function geometryPoint(geometry) {
  if (geometry?.type === 'Point' && validCoordinates(geometry.coordinates)) return geometry.coordinates;
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates?.[0] : geometry?.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0] : null;
  if (!Array.isArray(ring) || !ring.length || !ring.every(validCoordinates)) return null;
  // Display-only approximate center of the supplied boundary, never a precise impact location.
  return [ring.reduce((sum, c) => sum + Number(c[0]), 0) / ring.length, ring.reduce((sum, c) => sum + Number(c[1]), 0) / ring.length];
}
export function normalizeNws(raw, now = Date.now()) {
  const rows = requiredArray(raw?.features, 'NWS');
  if (raw.type !== 'FeatureCollection') throw new Error('Invalid NWS collection');
  const generatedAt = time(raw.updated);
  if (!generatedAt || generatedAt > now + 60_000 || now - generatedAt > 30 * 60_000) throw new Error('NWS feed generation is unavailable or delayed');
  if (rows.length && !rows.some(row => row?.properties?.id && ['Actual', 'Test', 'Exercise', 'System', 'Draft'].includes(row.properties.status))) throw new Error('Malformed NWS alert records');
  let eligibleCount = 0;
  const items = rows.flatMap(row => {
    const p = row.properties || {}, observedAt = time(p.sent), expiresAt = time(p.expires), url = https(p['@id'] || row.id);
    if (p.status !== 'Actual' || p.messageType === 'Cancel' || expiresAt !== null && expiresAt <= now) return [];
    eligibleCount++;
    if (!p.id || !p.event || !observedAt || !expiresAt || !url) return [];
    const point = geometryPoint(row.geometry), longitude = point ? Number(point[0]) : null, latitude = point ? Number(point[1]) : null;
    return [{ id: `nws:${p.id}`, sourceId: 'nws', title: text(p.headline || p.event), kind: classifyEarthKind(p.event),
      latitude, longitude, region: 'North America', severity: ['extreme', 'severe', 'moderate', 'minor'].includes(String(p.severity).toLowerCase()) ? p.severity.toLowerCase() : 'unknown',
      status: text(p.event), mode: /warning|watch|advisory/i.test(p.event) ? 'warning' : 'forecast', observedAt, expiresAt,
      url, provider: text(p.senderName || 'NOAA NWS', 200), summary: text(`${p.areaDesc || ''}. ${p.description || ''} ${p.instruction || ''}`),
      locationApproximate: !!point && row.geometry?.type !== 'Point' }];
  });
  if (eligibleCount && !items.length) throw new Error('No valid active NWS alerts');
  return { data: { items }, observedAt: newest(items.map(item => item.observedAt)) };
}
export function normalizeTsunami(content, now = Date.now()) {
  const raw = xml(content);
  if (!raw.feed) throw new Error('Expected NTWC Atom feed');
  const rows = array(raw.feed.entry);
  if (rows.length && !rows.some(row => row && row.title && time(row.updated || row.published))) throw new Error('Malformed NTWC bulletins');
  const items = rows.flatMap(row => {
    const observedAt = time(row.updated || row.published), summary = text(row.summary), title = text(row.title);
    if (!observedAt || now - observedAt > 24 * HOUR) return [];
    const links = array(row.link), url = https(links.find(link => link['@_rel'] === 'alternate')?.['@_href']) || 'https://www.tsunami.gov/';
    const latitude = number(row['geo:lat']), longitude = number(row['geo:long']);
    const category = summary.match(/Category:\s*(Warning|Watch|Advisory|Information|Cancellation)/i)?.[1] || 'Unclassified bulletin';
    const warning = ['Warning', 'Watch', 'Advisory'].includes(category) && !/NO tsunami danger|no tsunami threat|cancell/i.test(summary);
    return [{ id: `tsunami:${text(row.id || observedAt)}`, sourceId: 'tsunami', title: `${category} · ${title}`,
      kind: 'tsunami', latitude, longitude, region: latitude !== null && longitude !== null ? earthRegion(latitude, longitude) : 'Global',
      severity: warning ? (category === 'Warning' ? 'severe' : 'moderate') : 'unknown', status: warning ? category : `${category} bulletin · check source`,
      mode: warning ? 'warning' : 'observed', observedAt, expiresAt: observedAt + 24 * HOUR, url, provider: 'NOAA NTWC', summary }];
  });
  return { data: { items }, observedAt: time(raw.feed?.updated) };
}
export function normalizeMetWeather(raw, location) {
  const rows = requiredArray(raw?.properties?.timeseries, 'MET Norway');
  const modelRunAt = time(raw.properties?.meta?.updated_at);
  if (!modelRunAt) throw new Error('Missing weather model timestamp');
  const forecast = rows.slice(0, 24).flatMap(row => {
    const instant = row.data?.instant?.details, hourly = row.data?.next_1_hours;
    const validAt = time(row.time), temperatureC = number(instant?.air_temperature), wind = number(instant?.wind_speed);
    if (!validAt || temperatureC === null) return [];
    return [{ time: validAt, temperatureC, windKmh: wind === null ? null : Math.round(wind * 36) / 10,
      precipitationMm: number(hourly?.details?.precipitation_amount), symbol: text(hourly?.summary?.symbol_code || '', 100) }];
  });
  if (!forecast.length) throw new Error('No valid weather points');
  return { data: { items: [{ ...location, sourceId: `met-${location.id}`, modelRunAt, current: forecast[0], forecast,
    sourceUrl: `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${location.latitude.toFixed(2)}&lon=${location.longitude.toFixed(2)}` }] }, observedAt: modelRunAt };
}
export function normalizeRiver(raw, gauge) {
  if (String(raw?.lid).toUpperCase() !== gauge.id) throw new Error('Unexpected river gauge');
  const current = raw.status?.observed, stage = number(current?.primary), observedAt = time(current?.validTime);
  if (stage === null || stage <= -999 || !observedAt || !current.primaryUnit) throw new Error('No observed river level');
  const thresholds = Object.fromEntries(['action', 'minor', 'moderate', 'major'].map(key => {
    const threshold = number(raw.flood?.categories?.[key]?.stage); return [key, threshold !== null && threshold > -999 ? threshold : null];
  }));
  return { data: { items: [{ id: gauge.id, sourceId: `river-${gauge.id}`, name: text(raw.name || gauge.name, 200),
    latitude: number(raw.latitude) ?? gauge.latitude, longitude: number(raw.longitude) ?? gauge.longitude, region: 'North America', observedAt,
    stage, unit: text(current.primaryUnit, 50), floodCategory: text(current.floodCategory || 'Unknown', 100), thresholds,
    sourceUrl: `https://water.noaa.gov/gauges/${gauge.id.toLowerCase()}` }] }, observedAt };
}
export function normalizeEarthNews(content, sourceId) {
  // NASA Science currently omits whitespace between these two root namespace attributes.
  // Repair only that exact provider serialization defect, then validate XML normally.
  if (sourceId === 'news-nasa') content = content.replace('xmlns:apod="https://science.nasa.gov/apod/"xmlns:media=', 'xmlns:apod="https://science.nasa.gov/apod/" xmlns:media=');
  const config = EARTH_SOURCES[sourceId], raw = xml(content);
  const rows = array(raw.rss?.channel?.item ?? raw.feed?.entry);
  const items = rows.flatMap(row => {
    const title = text(row.title, 500), publishedAt = time(row.pubDate || row.published || row.updated || row['dc:date']);
    const url = https(typeof row.link === 'string' ? row.link : array(row.link).find(link => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href']);
    if (!title || !publishedAt || !url) return [];
    return [{ id: `${sourceId}:${url}`, sourceId, title, url, publisher: config.provider, publishedAt,
      kind: classifyEarthKind(title), region: newsRegion(title), official: config.official === true,
      // Reporting sources retain headline/source links; no republishing article text.
      summary: config.official ? text(row.description || row.summary, 280) : '' }];
  });
  const normalized = result(items, rows);
  // A general environment RSS also contains chemical/product and party-politics
  // stories. Keep reporting relevant to natural hazards or Earth phenomena.
  if (sourceId === 'news-guardian') normalized.data.items = normalized.data.items.filter(item => item.kind !== 'other'
    || /geolog|glacier|sea.level|climate|ocean|coral|erosion|landslide|avalanche|natural|biodiversity|wildlife|ecosystem|ecolog|meteorolog|tectonic/i.test(item.title));
  normalized.data.items = normalized.data.items.slice(0, 60);
  normalized.observedAt = newest(normalized.data.items.map(item => item.publishedAt));
  return normalized;
}
export async function fetchEarthSource(sourceId, { now = Date.now(), fetchFn } = {}) {
  const config = EARTH_SOURCES[sourceId];
  if (!config) throw new Error('Unknown Earth source');
  if (sourceId === 'usgs') return normalizeEarthquakes(await json('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', fetchFn), now);
  if (sourceId === 'eonet') return normalizeEonet(await json('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300', fetchFn));
  if (sourceId === 'gdacs') return normalizeGdacs(await providerText('https://www.gdacs.org/xml/rss.xml', fetchFn), now);
  if (sourceId === 'nws') return normalizeNws(await json('https://api.weather.gov/alerts/active?status=actual', fetchFn), now);
  if (sourceId === 'tsunami') return normalizeTsunami(await providerText('https://www.tsunami.gov/events/xml/PAAQAtom.xml', fetchFn), now);
  if (config.location) return normalizeMetWeather(await json(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${config.location.latitude.toFixed(2)}&lon=${config.location.longitude.toFixed(2)}`, fetchFn), config.location);
  if (config.gauge) return normalizeRiver(await json(`https://api.water.noaa.gov/nwps/v1/gauges/${config.gauge.id}`, fetchFn), config.gauge);
  const newsUrl = { 'news-nasa': 'https://science.nasa.gov/feed/?science_org=19791%2C22453', 'news-nhc': 'https://www.nhc.noaa.gov/index-at.xml', 'news-guardian': 'https://www.theguardian.com/us/environment/rss' }[sourceId];
  if (newsUrl) return normalizeEarthNews(await providerText(newsUrl, fetchFn), sourceId);
  throw new Error('Source uses an existing cache, not an Earth ingestion');
}
