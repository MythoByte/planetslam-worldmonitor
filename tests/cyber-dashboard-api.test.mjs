import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/cyber-dashboard.js';

test('cyber API rejects invalid datasets/methods before accessing cache', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected fetch'); };
  try {
    assert.equal((await handler(new Request('https://planetslam.com/api/cyber-dashboard?dataset=__proto__'))).status, 400);
    assert.equal((await handler(new Request('https://planetslam.com/api/cyber-dashboard', { method: 'POST' }))).status, 405);
  } finally { globalThis.fetch = saved; }
});
test('cyber API is cache-only and health keeps source failures visible', async () => {
  const fetchSaved = globalThis.fetch;
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'; process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-only';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const commands = JSON.parse(options.body); calls.push({ url, commands });
    return Response.json(commands.map(() => ({ result: null })));
  };
  try {
    const health = await (await handler(new Request('https://planetslam.com/api/cyber-dashboard?dataset=health'))).json();
    assert.equal(health.status, 'unavailable'); assert.equal(health.data.items.length, 6);
    assert.ok(health.data.items.every(i => i.status === 'unavailable' && i.data === null && i.provider));
    assert.equal(calls[0].url, 'https://redis.example/pipeline');
    assert.ok(calls[0].commands.every(c => c[0] === 'GET' && c[1].startsWith('cyber-dashboard:')));
    const news = await (await handler(new Request('https://planetslam.com/api/cyber-dashboard?dataset=news'))).json();
    assert.equal(news.data, null); assert.equal(news.status, 'unavailable');
  } finally {
    globalThis.fetch = fetchSaved;
    if (url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = url;
    if (token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = token;
  }
});
