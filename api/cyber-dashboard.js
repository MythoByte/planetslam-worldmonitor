import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { readJsonBatchFromUpstashWithStatus } from './_upstash-json.js';
import { CYBER_NEWS_SOURCES } from './_cyber-incidents.js';
import { CYBER_DATASETS, cyberKey, cyberEnvelope, aggregateCyberNews } from './_cyber-data.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const headers = { ...getCorsHeaders(req), 'Cache-Control': 'no-store' };
  if (isDisallowedOrigin(req)) return jsonResponse({ error: 'Origin not allowed' }, 403, headers);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, { ...headers, Allow: 'GET, OPTIONS' });
  const dataset = new URL(req.url).searchParams.get('dataset') || 'health';
  if (!['news', 'health', 'kev', 'incidents', 'infrastructure', 'epss', 'cvss', 'brief'].includes(dataset)) return jsonResponse({ error: 'Unknown dataset' }, 400, headers);
  const names = dataset === 'news' ? CYBER_NEWS_SOURCES : dataset === 'health' ? Object.keys(CYBER_DATASETS) : [dataset];
  const rows = await readJsonBatchFromUpstashWithStatus(names.map(cyberKey), 3000, true);
  const now = Date.now(), results = names.map((n, i) => cyberEnvelope(n, rows[i]?.value, now));
  if (dataset === 'news') return jsonResponse(aggregateCyberNews(results, now), 200, headers);
  if (dataset === 'health') return jsonResponse({ dataset, provider: 'PlanetSlam Cyber', sourceUrl: 'https://planetslam.com/dashboard?variant=cyber',
    status: results.every(r => r.status === 'fresh') ? 'fresh' : results.every(r => r.status === 'unavailable') ? 'unavailable' : 'stale',
    fetchedAt: now, observedAt: null, expiresAt: now + 60_000, data: { items: results.map(({ data, ...meta }) => ({ ...meta, data: null })) } }, 200, headers);
  return jsonResponse(results[0], 200, headers);
}
