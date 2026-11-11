import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/commercial-shipping.js';

test('commercial map endpoint forwards only the area to the authenticated relay and preserves failures', async () => {
  const oldFetch = globalThis.fetch;
  const saved = { ...process.env };
  process.env.WS_RELAY_URL = 'wss://relay.example.test';
  process.env.RELAY_SHARED_SECRET = 'synthetic-relay-secret';
  process.env.WORLDMONITOR_VALID_KEYS = 'synthetic-map-key';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const requests = [];
  let upstreamStatus = 200;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: init.headers });
    return Response.json(upstreamStatus === 200 ? { vessels: [], available: true, limited: false } : { error: 'Unavailable' }, { status: upstreamStatus });
  };
  try {
    const request = () => new Request('https://planetslam.com/api/commercial-shipping?candidates=true&url=https://untrusted.test', {
      headers: { 'X-WorldMonitor-Key': 'synthetic-map-key' },
    });
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { vessels: [], available: true, limited: false });
    assert.equal(requests.at(-1).url, 'https://relay.example.test/ais/snapshot?commercial=true');
    assert.equal(requests.at(-1).headers['x-relay-key'], 'synthetic-relay-secret');
    const area = await handler(new Request('https://planetslam.com/api/commercial-shipping?bbox=24,54,28,58&commercial=false&candidates=true', {
      headers: { 'X-WorldMonitor-Key': 'synthetic-map-key' },
    }));
    assert.equal(area.status, 200);
    assert.equal(requests.at(-1).url, 'https://relay.example.test/ais/snapshot?commercial=true&bbox=24%2C54%2C28%2C58');
    upstreamStatus = 503;
    const failure = await handler(request());
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get('Cache-Control'), 'no-store');
    assert.equal(JSON.stringify(await failure.json()).includes('synthetic-relay-secret'), false);
    const anonymous = await handler(new Request('https://planetslam.com/api/commercial-shipping'));
    assert.equal(anonymous.status, 401);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
