import { missionStillUpcoming } from '../api/_space-missions.js';

const text = (value, length = 2000) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length) : '';
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};
const url = value => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; } };

export function missionDatePrecision(value) {
  const name = text(value).toLowerCase();
  return ['second', 'minute', 'hour', 'day', 'month', 'quarter', 'year'].find(precision => name === precision) || 'unknown';
}

export function missionDurationSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  let seconds = null;
  if (typeof value === 'number') seconds = value;
  else if (typeof value === 'string') {
    const iso = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
    const clock = value.match(/^(?:(\d+)\s+)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (iso && iso.slice(1).some(Boolean)) seconds = Number(iso[1] || 0) * 86400 + Number(iso[2] || 0) * 3600 + Number(iso[3] || 0) * 60 + Number(iso[4] || 0);
    else if (clock && Number(clock[3]) < 60 && Number(clock[4]) < 60) seconds = Number(clock[1] || 0) * 86400 + Number(clock[2]) * 3600 + Number(clock[3]) * 60 + Number(clock[4]);
  }
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 7 * 86400 ? seconds : null;
}

function kind(type, name) {
  const classify = value => /spacewalk|\bEVA\b/i.test(value) ? 'spacewalk' : /dock|berthing/i.test(value) ? 'docking'
    : /landing|splashdown/i.test(value) ? 'landing' : /press|brief|conference/i.test(value) ? 'briefing' : 'other';
  const byType = classify(type);
  return byType === 'other' ? classify(name) : byType;
}

export function normalizeMissions(raw, now = Date.now()) {
  if (!raw || !Array.isArray(raw.results) || !Number.isInteger(raw.count) || raw.count < raw.results.length || (raw.count > 0 && !raw.results.length)) throw new Error('Invalid mission events payload');
  const items = [];
  let validCount = 0;
  const seen = new Set();
  for (const row of raw.results.slice(0, 100)) {
    const id = typeof row?.id === 'string' || Number.isInteger(row?.id) ? String(row.id) : '';
    const name = text(row?.name), at = date(row?.date);
    if (!id || !name || !at) continue;
    validCount++;
    const type = text(row.type?.name || 'Mission event');
    const status = text(typeof row.status === 'string' ? row.status : row.status?.name) || 'Scheduled · provider estimate';
    const datePrecision = missionDatePrecision(row.date_precision?.name);
    if (!missionStillUpcoming({ date: at, datePrecision, status, name }, now) || seen.has(id)) continue;
    seen.add(id);
    const windowStart = date(row.window_start), end = date(row.window_end);
    const windowEnd = windowStart && end && end < windowStart ? null : end;
    const information = (Array.isArray(row.info_urls) ? row.info_urls : []).map(link => url(link.url)).find(Boolean);
    const webcastUrl = (Array.isArray(row.vid_urls) ? [...row.vid_urls].sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0)) : []).map(link => url(link.url)).find(Boolean) || '';
    items.push({ id, name, kind: kind(type, name), type, description: text(row.description, 6000), date: at,
      datePrecision, datePrecisionDescription: text(row.date_precision?.description),
      windowStart, windowEnd, durationSeconds: missionDurationSeconds(row.duration), location: text(row.location), status,
      webcastUrl, url: information || url(row.url) || `https://ll.thespacedevs.com/2.3.0/events/${encodeURIComponent(id)}/`,
      launchIds: (Array.isArray(row.launches) ? row.launches.slice(0, 100) : []).flatMap(launch => launch?.id ? [String(launch.id)] : []), updatedAt: date(row.last_updated) });
  }
  if (raw.results.length && !validCount) throw new Error('No valid mission event records');
  items.sort((a, b) => a.date - b.date);
  return { data: { items: items.slice(0, 30), totalCount: raw.count, truncated: !!raw.next || raw.count > raw.results.length || items.length > 30 }, observedAt: null };
}

export async function fetchMissions({ now = Date.now(), fetchFn = fetch, launchKey = process.env.SPACEDEVS_API_KEY } = {}) {
  // The upcoming endpoint owns the provider window. An extra date>=now filter
  // would hide coarse same-day/month/year estimates before normalization.
  const params = new URLSearchParams({ limit: '30', mode: 'detailed', ordering: 'date' });
  const response = await fetchFn(`https://ll.thespacedevs.com/2.3.0/events/upcoming/?${params}`, {
    headers: { 'User-Agent': 'PlanetSlam-Space/1.0 (+https://planetslam.com)', Accept: 'application/json', ...(launchKey ? { Authorization: `Token ${launchKey}` } : {}) },
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Mission provider HTTP ${response.status}`);
  const content = await response.text();
  if (content.length > 6_000_000) throw new Error('Mission payload exceeds limit');
  return normalizeMissions(JSON.parse(content), now);
}

// Twelve shared one-hour tickets bound every rolling hour, across restarts and
// concurrent workers. SET NX PX is supported by both hosted and self-hosted Redis.
// Nominal launches4/h + missions4/h =8/h; cap12 leaves headroom under free15/h.
export async function admitTsdRequest(command, requestId) {
  for (let ticket = 0; ticket < 12; ticket++) {
    const response = await command(['SET', `space:tsd:request-budget:v1:${ticket}`, requestId, 'NX', 'PX', 3600_000]);
    if (response?.result === 'OK') return true;
    if (response?.result !== null) throw new Error('Provider budget unavailable');
  }
  return false;
}
