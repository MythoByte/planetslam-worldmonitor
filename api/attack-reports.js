import { createRelayHandler } from './_relay.js';
export const config = { runtime: 'edge' };
export default createRelayHandler({
  relayPath: '/gdelt/attack-reports', forwardSearch: false,
  requireApiKey: true, requireRateLimit: true, timeout: 10_000,
  cacheHeaders: ok => ({ 'Cache-Control': ok ? 'private, max-age=60' : 'no-store' }),
});
