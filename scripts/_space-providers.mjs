import { parseRssItems } from './seed-climate-news.mjs';

const UA = 'PlanetSlam-Space/1.0 (+https://planetslam.com)';
const DAY = 86_400_000;
const date = ms => new Date(ms).toISOString().slice(0, 10);
export function time(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const valueMs = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(valueMs) ? valueMs : null;
}
const text = (value, max = 2000) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export function httpsUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
const number = value => value === null || value === '' || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const requiredArray = (value, name) => { if (!Array.isArray(value)) throw new Error(`Invalid ${name} payload`); return value; };
const newest = items => Math.max(0, ...items.filter(Number.isFinite)) || null;

export async function providerJson(url, fetchFn = fetch) {
  const response = await fetchFn(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const content = await response.text();
  if (content.length > 6_000_000) throw new Error('Provider payload exceeds limit');
  return JSON.parse(content);
}

export function normalizeApod(raw) {
  const items = requiredArray(raw, 'APOD').flatMap(item => {
    const url = httpsUrl(item.url);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.title || !url || !['image', 'video'].includes(item.media_type)) return [];
    return [{ date: item.date, title: text(item.title), explanation: text(item.explanation, 8000), mediaType: item.media_type,
      url, hdUrl: httpsUrl(item.hdurl), thumbnailUrl: httpsUrl(item.thumbnail_url), credit: text(item.copyright || 'NASA / APOD'),
      sourceUrl: `https://apod.nasa.gov/apod/ap${item.date.slice(2).replaceAll('-', '')}.html` }];
  }).sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) throw new Error('No valid APOD records');
  return { data: { items }, observedAt: time(`${items[0].date}T00:00:00Z`) };
}

export function normalizeNews(raw, rssItems = []) {
  const apiItems = requiredArray(raw?.results, 'news').flatMap(item => {
    const url = httpsUrl(item.url), publishedAt = time(item.published_at);
    return item.title && url && publishedAt ? [{ id: String(item.id), title: text(item.title), url,
      summary: text(item.summary, 500), publisher: text(item.news_site), publishedAt,
      launchIds: (Array.isArray(item.launches) ? item.launches : []).map(l => String(l.launch_id)) }] : [];
  });
  const seen = new Set();
  const items = [...apiItems, ...rssItems.map(i => ({ id: i.id, title: text(i.title), url: httpsUrl(i.url),
    summary: text(i.summary, 500), publisher: text(i.sourceName), publishedAt: i.publishedAt, launchIds: [] }))]
    .filter(i => i.url && !seen.has(i.url) && seen.add(i.url)).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 75);
  if (!items.length) throw new Error('No valid news records');
  return { data: { items }, observedAt: newest(items.map(i => i.publishedAt)) };
}

export function normalizeLaunches(raw, now = Date.now()) {
  const rows = requiredArray(raw?.results, 'launches');
  if (!rows.length && raw.count !== 0) throw new Error('Unconfirmed empty launch result');
  const items = rows.flatMap(item => {
    const net = time(item.net);
    if (!item.id || !item.name || !net) return [];
    return [{ id: String(item.id), name: text(item.name), net, windowStart: time(item.window_start), windowEnd: time(item.window_end),
      status: text(item.status?.name), provider: text(item.launch_service_provider?.name), rocket: text(item.rocket?.configuration?.full_name || item.rocket?.configuration?.name),
      mission: text(item.mission?.description), pad: text(item.pad?.name), latitude: number(item.pad?.latitude), longitude: number(item.pad?.longitude),
      webcastUrl: (Array.isArray(item.vid_urls) ? item.vid_urls : []).map(i => httpsUrl(i.url)).find(Boolean) || '',
      url: httpsUrl(item.info_urls?.[0]?.url) || `https://spacelaunchnow.me/launch/${encodeURIComponent(item.slug || item.id)}/` }];
  });
  if (rows.length && !items.length) throw new Error('No valid launch records');
  const upcoming = items.filter(item => item.net >= now && !/success|fail|cancel|in flight|payload deployed/i.test(item.status))
    .sort((a, b) => a.net - b.net);
  return { data: { items: upcoming }, observedAt: null };
}

export function normalizeWeather(scalesRaw, kpRaw, windRaw, magRaw, alertsRaw) {
  const current = scalesRaw?.['0'];
  if (!current || !['G', 'R', 'S'].every(k => number(current[k]?.Scale) !== null)) throw new Error('Invalid NOAA scales');
  const scales = Object.fromEntries(['G', 'R', 'S'].map(k => [k, number(current[k].Scale)]));
  if (Object.values(scales).some(v => v < 0 || v > 5)) throw new Error('Invalid NOAA severity');
  const kp = requiredArray(kpRaw, 'Kp').map(row => ({ time: time(row.time_tag), value: number(row.estimated_kp ?? row.kp_index) }))
    .filter(row => row.time && row.value !== null && row.value >= 0 && row.value <= 9).sort((a, b) => a.time - b.time).slice(-180);
  const mags = requiredArray(magRaw, 'magnetometer').filter(row => row.active === true).map(row => ({ time: time(row.time_tag), bz: number(row.bz_gsm) }));
  const byMinute = new Map(mags.map(row => [Math.floor(row.time / 60_000), row.bz]));
  const wind = requiredArray(windRaw, 'solar wind').filter(row => row.active === true).map(row => ({ time: time(row.time_tag), speed: number(row.proton_speed), density: number(row.proton_density),
    bz: byMinute.get(Math.floor(time(row.time_tag) / 60_000)) ?? null }))
    .filter(row => row.time && row.speed !== null && row.speed > 0 && row.density !== null && row.density >= 0)
    .sort((a, b) => a.time - b.time).slice(-120);
  const alerts = requiredArray(alertsRaw, 'alerts').map(row => ({ id: text(row.product_id), message: text(row.message, 6000), issuedAt: time(row.issue_datetime) }))
    .filter(row => row.id && row.message && row.issuedAt).sort((a, b) => b.issuedAt - a.issuedAt).slice(0, 15);
  if (!kp.length || !wind.length || !mags.length) throw new Error('Incomplete NOAA observations');
  const scaleTime = time(`${current.DateStamp}T${current.TimeStamp}Z`);
  // Old component observations cannot be hidden by a fresh fetch of another component.
  const observedAt = Math.min(scaleTime || 0, kp.at(-1).time, wind.at(-1).time, newest(mags.map(i => i.time)) || 0);
  return { data: { scales, kp, wind, alerts }, observedAt };
}

export function normalizeAurora(raw) {
  const observationAt = time(raw?.['Observation Time']), forecastAt = time(raw?.['Forecast Time']);
  if (!observationAt || !forecastAt) throw new Error('Invalid aurora time');
  const coordinates = requiredArray(raw.coordinates, 'aurora');
  let validCount = 0;
  const points = coordinates.flatMap(row => {
    if (!Array.isArray(row) || row.length < 3 || !row.slice(0, 3).every(v => typeof v === 'number' && Number.isFinite(v))) return [];
    const [longitude, latitude, probability] = row;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 360 || probability < 0 || probability > 100) return [];
    validCount++;
    // Store only visible-intensity cells; 1-degree source grid remains available at NOAA.
    return probability >= 5 ? [{ longitude: longitude > 180 ? longitude - 360 : longitude, latitude, probability }] : [];
  });
  if (!validCount) throw new Error('Empty aurora grid');
  return { data: { forecastAt, observationAt, points }, observedAt: observationAt };
}

export function normalizeEvents(flares, cmes) {
  const items = [
    ...requiredArray(flares, 'DONKI flares').map(row => ({ id: text(row.flrID), type: 'flare', time: time(row.peakTime || row.beginTime), classType: text(row.classType), note: text(row.sourceLocation), url: httpsUrl(row.link) })),
    ...requiredArray(cmes, 'DONKI CMEs').map(row => ({ id: text(row.activityID), type: 'cme', time: time(row.startTime), classType: '', note: text(row.note), url: httpsUrl(row.link) })),
  ].filter(i => i.id && i.time).sort((a, b) => b.time - a.time).slice(0, 60);
  return { data: { items }, observedAt: newest(items.map(i => i.time)) };
}

export function normalizeNeo(raw) {
  if (!raw?.near_earth_objects || typeof raw.near_earth_objects !== 'object' || Array.isArray(raw.near_earth_objects)
    || !Number.isInteger(raw.element_count) || raw.element_count < 0) throw new Error('Invalid NEO payload');
  const rows = Object.values(raw.near_earth_objects).flatMap(row => requiredArray(row, 'NEO day'));
  if (raw.element_count > 0 && !rows.length) throw new Error('Incomplete NEO result');
  const items = rows.flatMap(row => requiredArray(row.close_approach_data, 'NEO approaches').flatMap(approach => {
    if (approach.orbiting_body !== 'Earth') return [];
    const approachAt = number(approach.epoch_date_close_approach), size = row.estimated_diameter?.kilometers;
    const diameterMinKm = number(size?.estimated_diameter_min), diameterMaxKm = number(size?.estimated_diameter_max);
    const missDistanceKm = number(approach.miss_distance?.kilometers), lunarDistance = number(approach.miss_distance?.lunar), velocityKmS = number(approach.relative_velocity?.kilometers_per_second);
    if (!row.id || !row.name || !approachAt || [diameterMinKm, diameterMaxKm, missDistanceKm, lunarDistance, velocityKmS].some(v => v === null || v < 0)
      || typeof row.is_potentially_hazardous_asteroid !== 'boolean') return [];
    return [{ id: String(row.id), name: text(row.name), approachAt, diameterMinKm, diameterMaxKm, missDistanceKm, lunarDistance, velocityKmS,
      potentiallyHazardous: row.is_potentially_hazardous_asteroid, url: httpsUrl(row.nasa_jpl_url?.replace(/^http:/, 'https:')) }];
  })).sort((a, b) => a.approachAt - b.approachAt);
  if (rows.length && !items.length) throw new Error('No valid NEO records');
  return { data: { items }, observedAt: null };
}

export async function fetchSpaceDataset(dataset, { fetchFn = fetch, now = Date.now(), nasaKey = process.env.NASA_API_KEY, launchKey = process.env.SPACEDEVS_API_KEY } = {}) {
  const json = url => providerJson(url, fetchFn);
  const nasa = (path, params) => {
    if (!nasaKey) throw new Error('NASA_API_KEY is required');
    return json(`https://api.nasa.gov/${path}?${new URLSearchParams({ ...params, api_key: nasaKey })}`);
  };
  switch (dataset) {
    case 'apod': return normalizeApod(await nasa('planetary/apod', { start_date: date(now - 6 * DAY), end_date: date(now), thumbs: 'true' }));
    case 'news': {
      const rss = [];
      for (const [name, url] of [['NASA', 'https://www.nasa.gov/feed/'], ['ESA', 'https://www.esa.int/rssfeed/TopNews']]) {
        try {
          const response = await fetchFn(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
          if (response.ok) rss.push(...parseRssItems((await response.text()).slice(0, 500_000), name));
        } catch { /* supplemental feeds may fail independently */ }
      }
      let payload;
      try { payload = await json('https://api.spaceflightnewsapi.net/v4/articles/?limit=50'); }
      catch (error) { if (!rss.length) throw error; payload = { results: [] }; }
      return normalizeNews(payload, rss);
    }
    case 'launches': {
      // Stable minute boundary shares LL2's cache across installations; the
      // normalizer also removes completed/past records from provider responses.
      const params = new URLSearchParams({ limit: '30', mode: 'detailed', ordering: 'net', net__gte: new Date(Math.floor(now / 60_000) * 60_000).toISOString() });
      const url = `https://ll.thespacedevs.com/2.3.0/launches/upcoming/?${params}`;
      const response = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...(launchKey ? { Authorization: `Token ${launchKey}` } : {}) }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (!response.ok) throw new Error(`Launch provider HTTP ${response.status}`);
      return normalizeLaunches(await response.json(), now);
    }
    case 'weather': {
      const [scales, kp, wind, mag, alerts] = await Promise.all([
        'products/noaa-scales.json', 'json/planetary_k_index_1m.json', 'json/rtsw/rtsw_wind_1m.json', 'json/rtsw/rtsw_mag_1m.json', 'products/alerts.json',
      ].map(path => json(`https://services.swpc.noaa.gov/${path}`)));
      return normalizeWeather(scales, kp, wind, mag, alerts);
    }
    case 'aurora': return normalizeAurora(await json('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json'));
    case 'solar': {
      const items = [];
      for (const [id, title] of [['0193', 'SDO AIA 193 Å — corona'], ['0304', 'SDO AIA 304 Å — chromosphere'], ['HMIIC', 'SDO HMI — visible Sun']]) {
        const url = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_${id}.jpg`;
        const response = await fetchFn(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
        const observedAt = time(response.headers.get('last-modified'));
        if (!response.ok || !observedAt) throw new Error('Solar image timestamp unavailable');
        items.push({ id, title, url, sourceUrl: 'https://sdo.gsfc.nasa.gov/data/', observedAt });
      }
      return { data: { items }, observedAt: Math.min(...items.map(i => i.observedAt)) };
    }
    case 'events': return normalizeEvents(await nasa('DONKI/FLR', { startDate: date(now - 7 * DAY), endDate: date(now) }), await nasa('DONKI/CME', { startDate: date(now - 7 * DAY), endDate: date(now) }));
    case 'neo': return normalizeNeo(await nasa('neo/rest/v1/feed', { start_date: date(now), end_date: date(now + 6 * DAY) }));
    default: throw new Error('Unknown space dataset');
  }
}
