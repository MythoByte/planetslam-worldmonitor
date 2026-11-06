import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './space.js';
import { normalizeMissions } from '../scripts/_space-missions.mjs';

test('space route rejects unknown datasets and methods before touching Redis', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected provider or Redis fetch'); };
  try {
    assert.equal((await handler(new Request('https://planetslam.com/api/space?dataset=__proto__'))).status, 400);
    assert.equal((await handler(new Request('https://planetslam.com/api/space', { method: 'POST' }))).status, 405);
  } finally { globalThis.fetch = original; }
});

test('space route reads raw shared cache only and returns fresh/stale/unavailable contract', async () => {
  const original = globalThis.fetch;
  const previous = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, commands: JSON.parse(options.body) });
    return Response.json([{ result: JSON.stringify({ dataset: 'launches', fetchedAt: Date.now(), observedAt: null, data: { items: [] } }) }]);
  };
  try {
    const response = await handler(new Request('https://planetslam.com/api/space?dataset=launches'));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, 'fresh');
    assert.deepEqual(payload.data.items, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://redis.example/pipeline');
    assert.deepEqual(calls[0].commands, [['GET', 'space:launches:v1']]);
  } finally {
    globalThis.fetch = original;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  }
});

test('missing Redis does not imply empty sky or zero storms; health keeps provider metadata', async () => {
  const previous = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const payload = await (await handler(new Request('https://planetslam.com/api/space?dataset=weather'))).json();
    assert.equal(payload.status, 'unavailable');
    assert.equal(payload.data, null);
    const health = await (await handler(new Request('https://planetslam.com/api/space?dataset=health'))).json();
    assert.equal(health.dataset, 'health');
    assert.equal(health.data.items.length, 11);
    assert.ok(health.data.items.every(row => row.status === 'unavailable' && row.provider));
  } finally {
    if (previous.url !== undefined) process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  }
});

test('malformed mission cache fields return unavailable before reaching the browser', async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL, previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-only';
  const now = Date.now();
  const data = normalizeMissions({ count: 1, results: [{ id: 123, name: 'Synthetic mission', date: new Date(now + 3600_000).toISOString(), type: { name: 'EVA' } }] }, now).data;
  globalThis.fetch = async () => Response.json([{ result: JSON.stringify({ dataset: 'missions', fetchedAt: now, data: { ...data, items: [{ ...data.items[0], description: null }] } }) }]);
  try {
    const result = await (await handler(new Request('https://planetslam.com/api/space?dataset=missions'))).json();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.data, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  }
});

test('daily brief route is cache-only, exposes evidence links and never starts model work', async () => {
  const { buildSpaceBrief } = await import('../scripts/_space-brief.mjs');
  const { spaceEnvelope } = await import('./_space-data.js');
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL, previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-only';
  const now = Date.now();
  const news = { dataset: 'news', fetchedAt: now, observedAt: now, data: { items: [{ id: 'news-1', title: 'Synthetic space science update', summary: 'Synthetic test source.', publishedAt: now, publisher: 'Synthetic publisher', url: 'https://example.org/science' }] } };
  const data = buildSpaceBrief({ news: spaceEnvelope('news', news, now) }, now);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, commands: JSON.parse(options.body) });
    return Response.json([{ result: JSON.stringify({ dataset: 'brief', fetchedAt: now, observedAt: now, data }) }]);
  };
  try {
    const result = await (await handler(new Request('https://planetslam.com/api/space?dataset=brief'))).json();
    assert.equal(result.status, 'fresh');
    assert.equal(result.data.mode, 'source-summary');
    assert.equal(result.data.sources[0].url, 'https://example.org/science');
    assert.deepEqual(calls, [{ url: 'https://redis.example/pipeline', commands: [['GET', 'space:brief:v1']] }]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  }
});
