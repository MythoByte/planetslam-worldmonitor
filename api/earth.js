import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { readJsonBatchFromUpstashWithStatus } from './_upstash-json.js';
import { EARTH_HISTORY_KEY, earthHistoryEnvelope } from './_earth-history.js';
import { EARTH_DATASETS, EARTH_SOURCES, earthKey, earthEnvelope } from './_earth-data.js';
export const config = { runtime: 'edge' };

// Public cache reader. Browser requests never cause calls to external providers.
export default async function handler(req) {
  const headers = { ...getCorsHeaders(req), 'Cache-Control': 'no-store' };
  if (isDisallowedOrigin(req)) return jsonResponse({ error: 'Origin not allowed' }, 403, headers);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, { ...headers, Allow: 'GET, OPTIONS' });
  const dataset = new URL(req.url).searchParams.get('dataset') || 'health';
  if (dataset === 'history') {
    const [row] = await readJsonBatchFromUpstashWithStatus([EARTH_HISTORY_KEY], 3000, true);
    return jsonResponse(earthHistoryEnvelope(row?.value), 200, headers);
  }
  if (dataset !== 'health' && !Object.hasOwn(EARTH_DATASETS, dataset)) return jsonResponse({ error: 'Unknown dataset' }, 400, headers);
  const ids = Object.keys(EARTH_SOURCES).filter(id => dataset === 'health' || EARTH_SOURCES[id].dataset === dataset);
  const rows = await readJsonBatchFromUpstashWithStatus(ids.map(earthKey), 3000, true);
  const snapshots = Object.fromEntries(ids.map((id, i) => [id, rows[i]?.value]));
  const now = Date.now();
  if (dataset !== 'health') return jsonResponse(earthEnvelope(dataset, snapshots, now), 200, headers);
  const items = Object.keys(EARTH_DATASETS).map(name => earthEnvelope(name, snapshots, now));
  const status = items.every(item => item.status === 'fresh') ? 'fresh' : items.every(item => item.status === 'unavailable') ? 'unavailable' : 'stale';
  return jsonResponse({ dataset: 'health', status, provider: 'PlanetSlam Earth', sourceUrl: 'https://planetslam.com/dashboard?variant=earth',
    coverage: 'Source freshness and coverage; a successful fetch does not imply a recently observed event.',
    fetchedAt: now, observedAt: null, expiresAt: now + 60_000,
    data: { items: items.map(({ data, ...meta }) => ({ ...meta, sources: data.sources })) } }, 200, headers);
}
