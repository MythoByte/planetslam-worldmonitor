import { createRelayHandler } from './_relay.js';

export const config = { runtime: 'edge' };

// A dedicated, bounded map response keeps civilian positions separate from
// the military-candidate RPC contract and never exposes provider credentials.
export default createRelayHandler({
  relayPath: '/ais/snapshot?commercial=true',
  buildRelayPath: (_req, url) => {
    const query = new URLSearchParams({ commercial: 'true' });
    if (url.searchParams.has('bbox')) query.set('bbox', url.searchParams.get('bbox'));
    return `/ais/snapshot?${query}`;
  },
  forwardSearch: false,
  requireApiKey: true,
  requireRateLimit: true,
  timeout: 10_000,
  cacheHeaders: ok => ({ 'Cache-Control': ok ? 'private, max-age=15' : 'no-store' }),
});
