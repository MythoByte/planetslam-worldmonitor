// Shared wire contract. Seeders import this same-directory-safe edge module.
import { projectOrbitCatalog, ORBIT_INTERVAL_MS, ORBIT_FETCH_MAX_AGE_MS } from './_space-orbits.js';
import { validMissionData, upcomingMissionItems } from './_space-missions.js';
import { validSpaceBrief, projectSpaceBrief, SPACE_BRIEF_MAX_AGE_MS } from './_space-brief.js';
const MINUTE = 60_000;
export const SPACE_DATASETS = Object.freeze({
  apod: { provider: 'NASA APOD', sourceUrl: 'https://apod.nasa.gov/', intervalMs: 6 * 60 * MINUTE, maxAgeMs: 48 * 60 * MINUTE },
  news: { provider: 'Spaceflight News API / NASA / ESA', sourceUrl: 'https://www.spaceflightnewsapi.net/', intervalMs: 15 * MINUTE, maxAgeMs: 6 * 60 * MINUTE },
  launches: { provider: 'The Space Devs Launch Library 2', sourceUrl: 'https://thespacedevs.com/llapi', intervalMs: 15 * MINUTE, maxAgeMs: 6 * 60 * MINUTE },
  weather: { provider: 'NOAA SWPC', sourceUrl: 'https://www.spaceweather.gov/', intervalMs: 5 * MINUTE, maxAgeMs: 60 * MINUTE },
  aurora: { provider: 'NOAA SWPC OVATION', sourceUrl: 'https://www.spaceweather.gov/products/aurora-30-minute-forecast', intervalMs: 5 * MINUTE, maxAgeMs: 60 * MINUTE },
  solar: { provider: 'NASA SDO', sourceUrl: 'https://sdo.gsfc.nasa.gov/data/', intervalMs: 15 * MINUTE, maxAgeMs: 6 * 60 * MINUTE },
  events: { provider: 'NASA DONKI', sourceUrl: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/', intervalMs: 60 * MINUTE, maxAgeMs: 24 * 60 * MINUTE },
  neo: { provider: 'NASA NeoWs', sourceUrl: 'https://cneos.jpl.nasa.gov/', intervalMs: 6 * 60 * MINUTE, maxAgeMs: 24 * 60 * MINUTE },
  orbits: { provider: 'CelesTrak GP / OMM', sourceUrl: 'https://celestrak.org/NORAD/elements/', intervalMs: ORBIT_INTERVAL_MS, maxAgeMs: ORBIT_FETCH_MAX_AGE_MS },
  brief: { provider: 'PlanetSlam Space daily brief', sourceUrl: 'https://planetslam.com/dashboard?variant=space', intervalMs: 5 * MINUTE, maxAgeMs: SPACE_BRIEF_MAX_AGE_MS },
  missions: { provider: 'The Space Devs Launch Library 2', sourceUrl: 'https://thespacedevs.com/llapi', intervalMs: 15 * MINUTE, maxAgeMs: 6 * 60 * MINUTE },
});

export const spaceKey = dataset => `space:${dataset}:v1`;

export function validSpaceData(dataset, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (dataset === 'orbits') return Array.isArray(data.items) && Array.isArray(data.groups);
  if (dataset === 'missions') return validMissionData(data);
  if (dataset === 'brief') return validSpaceBrief(data);
  if (dataset === 'weather') return data.scales && ['G', 'R', 'S'].every(k => Number.isFinite(data.scales[k]) && data.scales[k] >= 0 && data.scales[k] <= 5)
    && ['kp', 'wind', 'alerts'].every(k => Array.isArray(data[k])) && data.kp.length > 0 && data.wind.length > 0;
  if (dataset === 'aurora') return Number.isFinite(data.forecastAt) && Number.isFinite(data.observationAt) && Array.isArray(data.points);
  return Array.isArray(data.items) && (!['apod', 'news', 'solar'].includes(dataset) || data.items.length > 0);
}

export function spaceEnvelope(dataset, snapshot, now = Date.now()) {
  const config = SPACE_DATASETS[dataset];
  if (!config) throw new Error('Unknown space dataset');
  if (dataset === 'brief') return { dataset, provider: config.provider, sourceUrl: config.sourceUrl, ...projectSpaceBrief(snapshot, now) };
  if (dataset === 'orbits') {
    const projected = projectOrbitCatalog(snapshot?.dataset === dataset ? snapshot.data : null, now);
    return { dataset, provider: config.provider, sourceUrl: config.sourceUrl, ...projected,
      expiresAt: projected.fetchedAt ? projected.fetchedAt + ORBIT_FETCH_MAX_AGE_MS : null };
  }
  const fetchedAt = snapshot?.fetchedAt;
  const valid = snapshot?.dataset === dataset && validSpaceData(dataset, snapshot?.data)
    && Number.isFinite(fetchedAt) && fetchedAt > 0 && fetchedAt <= now + MINUTE;
  const age = valid ? Math.max(0, now - fetchedAt) : Infinity;
  const observedAt = Number.isFinite(snapshot?.observedAt) ? snapshot.observedAt : null;
  // Observation age matters for live solar/weather products, independently of fetch age.
  const observationExpired = ['weather', 'aurora', 'solar', 'apod'].includes(dataset)
    && (!observedAt || now - observedAt > config.maxAgeMs || observedAt > now + MINUTE);
  const publicationDelayed = dataset === 'apod' && observedAt && now - observedAt > 36 * 60 * MINUTE;
  const status = age > config.maxAgeMs || observationExpired ? 'unavailable'
    : age > config.intervalMs * 2 || publicationDelayed ? 'stale' : 'fresh';
  const data = status === 'unavailable' ? null : dataset === 'launches' ? {
    ...snapshot.data,
    // Cache-only readers must age launches as time passes between seed runs.
    // This is a filtered current batch, not a statement about all global launches.
    items: snapshot.data.items.filter(item => Number.isFinite(item.net) && item.net >= now
      && !/success|fail|cancel|in flight|payload deployed/i.test(item.status || '')),
  } : dataset === 'missions' ? { ...snapshot.data, items: upcomingMissionItems(snapshot.data.items, now) } : snapshot.data;
  return {
    dataset, status, provider: config.provider, sourceUrl: config.sourceUrl,
    fetchedAt: valid ? fetchedAt : null, observedAt,
    expiresAt: valid ? fetchedAt + config.maxAgeMs : null,
    ...(status === 'unavailable' ? { message: 'Current data unavailable. Check source or provider configuration.' }
      : status === 'stale' ? { message: 'Last available update; provider refresh is delayed.' } : {}),
    data,
  };
}
