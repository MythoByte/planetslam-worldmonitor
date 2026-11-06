import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { readJsonBatchFromUpstashWithStatus } from './_upstash-json.js';
import { SPACE_DATASETS, spaceKey, spaceEnvelope } from './_space-data.js';

export const config = { runtime: 'edge' };

// Public, read-only, cache-only endpoint. Requests never trigger provider work.
export default async function handler(req) {
  const headers = { ...getCorsHeaders(req), 'Cache-Control': 'no-store' };
  if (isDisallowedOrigin(req)) return jsonResponse({ error: 'Origin not allowed' }, 403, headers);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, { ...headers, Allow: 'GET, OPTIONS' });
  const dataset = new URL(req.url).searchParams.get('dataset') || 'health';
  if (dataset !== 'health' && !Object.hasOwn(SPACE_DATASETS, dataset)) {
    return jsonResponse({ error: 'Unknown dataset' }, 400, headers);
  }
  const names = dataset === 'health' ? Object.keys(SPACE_DATASETS) : [dataset];
  const rows = await readJsonBatchFromUpstashWithStatus(names.map(spaceKey), 3000, true);
  const now = Date.now();
  const results = names.map((name, i) => spaceEnvelope(name, rows[i]?.value, now));
  if (dataset === 'health') {
    const status = results.every(row => row.status === 'fresh') ? 'fresh'
      : results.every(row => row.status === 'unavailable') ? 'unavailable' : 'stale';
    return jsonResponse({ dataset: 'health', status, provider: 'PlanetSlam Space', sourceUrl: 'https://planetslam.com/dashboard?variant=space',
      fetchedAt: now, observedAt: null, expiresAt: now + 60_000,
      data: { items: results.map(({ data, ...meta }) => ({ ...meta, data: null })) } }, 200, headers);
  }
  return jsonResponse(results[0], 200, headers);
}
