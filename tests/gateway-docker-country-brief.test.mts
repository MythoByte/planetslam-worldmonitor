import { isDockerLocalAnalysisSession } from '../server/_shared/docker-local-analysis';
import { PLANETSLAM_LOCAL_ANALYSIS_ROUTES } from '../src/shared/planetslam-local-panels';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { issueSessionToken } from '../api/_session.js';
import { createDomainGateway } from '../server/gateway.ts';
import { hashKeySync } from '../server/_shared/usage-identity.ts';
import type { RouteDescriptor } from '../server/router.ts';

const COUNTRY_BRIEF_PATH = '/api/intelligence/v1/get-country-intel-brief';
const OTHER_PREMIUM_PATH = '/api/market/v1/analyze-stock';
const CLIENT_IP = '203.0.113.77';
const SESSION_SECRET = 'docker-country-brief-session-secret-32';
const originalFetch = globalThis.fetch;
const originalEnv = {
  LOCAL_API_MODE: process.env.LOCAL_API_MODE,
  PLANETSLAM_LOCAL_ANALYSIS: process.env.PLANETSLAM_LOCAL_ANALYSIS,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OLLAMA_API_URL: process.env.OLLAMA_API_URL,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  WM_SESSION_SECRET: process.env.WM_SESSION_SECRET,
  WORLDMONITOR_VALID_KEYS: process.env.WORLDMONITOR_VALID_KEYS,
};

type RedisCommand = Array<string | number>;
type RedisPipeline = RedisCommand[];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureGatewayEnv(mode: 'docker' | 'cloud'): void {
  process.env.LOCAL_API_MODE = mode;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-test-token';
  process.env.WM_SESSION_SECRET = SESSION_SECRET;
  delete process.env.WORLDMONITOR_VALID_KEYS;
  delete process.env.PLANETSLAM_LOCAL_ANALYSIS;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OLLAMA_API_URL;
}

function installRedisPipelineMock(options: { initialDirectLlmCount?: number } = {}) {
  const store = new Map<string, { count: number; expires: boolean }>();
  const pipelines: string[] = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body)) as RedisPipeline;
    pipelines.push(String(init?.body));

    const results = commands.map((command) => {
      const operation = String(command[0]).toUpperCase();
      if (['EVAL', 'EVALSHA', 'SCRIPT'].includes(operation)) {
        return { error: `Command not allowed: ${operation}` };
      }

      const key = String(command[1]);
      const isDirectLlmKey = key.includes('llm:direct-usage:');
      const entry = store.get(key) ?? {
        count: isDirectLlmKey ? options.initialDirectLlmCount ?? 0 : 0,
        expires: false,
      };

      if (operation === 'INCR') {
        entry.count += 1;
        store.set(key, entry);
        return { result: entry.count };
      }
      if (operation === 'EXPIRE') {
        const applied = entry.expires ? 0 : 1;
        entry.expires = true;
        store.set(key, entry);
        return { result: applied };
      }
      if (operation === 'TTL') {
        return { result: entry.expires ? 60 : -1 };
      }
      return { result: 1 };
    });

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    pipelines,
    directLlmKeys: () => pipelines.flatMap((pipeline) => {
      const commands = JSON.parse(pipeline) as RedisPipeline;
      return commands
        .filter(([operation]) => String(operation).toUpperCase() === 'INCR')
        .map(([, key]) => String(key))
        .filter((key) => key.includes('llm:direct-usage:'));
    }),
  };
}

function makeGateway(handlerCalls: Record<string, number>) {
  const routes: RouteDescriptor[] = [
    {
      method: 'GET',
      path: COUNTRY_BRIEF_PATH,
      handler: async () => {
        handlerCalls.country += 1;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    {
      method: 'GET',
      path: OTHER_PREMIUM_PATH,
      handler: async () => {
        handlerCalls.other += 1;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  ];
  for (const [path, method] of Object.entries(PLANETSLAM_LOCAL_ANALYSIS_ROUTES)) {
    if (path === OTHER_PREMIUM_PATH) continue;
    routes.push({ method, path, handler: async () => {
      handlerCalls.other += 1;
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    } });
  }
  return createDomainGateway(routes);
}

function request(
  path: string,
  token?: string,
  options: { clientIp?: string | null; method?: 'GET' | 'POST' } = {},
): Request {
  const headers = new Headers({
    Origin: 'https://worldmonitor.app',
  });
  const clientIp = options.clientIp === undefined ? CLIENT_IP : options.clientIp;
  if (clientIp) headers.set('X-Real-IP', clientIp);
  if (token) headers.set('X-WorldMonitor-Key', token);
  const method = options.method ?? 'GET';
  const body = method === 'POST' ? JSON.stringify({ country_code: 'US' }) : undefined;
  if (body) {
    headers.set('Content-Type', 'application/json');
    headers.set('Content-Length', String(new TextEncoder().encode(body).byteLength));
  }
  return new Request(`https://worldmonitor.app${path}?country_code=US`, {
    method,
    headers,
    body,
  });
}

describe('Docker country-intel gateway auth (#5415)', () => {
  it('lets a valid anonymous session use the local country brief with a bounded per-IP LLM quota', async () => {
    configureGatewayEnv('docker');
    const redis = installRedisPipelineMock();
    const token = (await issueSessionToken()).token;
    const handlerCalls = { country: 0, other: 0 };

    const response = await makeGateway(handlerCalls)(request(COUNTRY_BRIEF_PATH, token));

    assert.equal(response.status, 200);
    assert.equal(handlerCalls.country, 1);
    const directKeys = redis.directLlmKeys();
    assert.equal(directKeys.length, 1);
    assert.ok(
      directKeys[0]?.includes(`docker:${hashKeySync(CLIENT_IP)}`),
      `expected a hashed Docker IP principal, got ${directKeys[0] ?? 'none'}`,
    );
    assert.ok(
      directKeys.every((key) => !key.includes(CLIENT_IP)),
      'the direct-LLM spend key must not contain a raw client IP',
    );
  });

  it('keeps the same session denial on cloud and on other premium routes', async () => {
    configureGatewayEnv('docker');
    const token = (await issueSessionToken()).token;
    installRedisPipelineMock();
    const handlerCalls = { country: 0, other: 0 };
    const gateway = makeGateway(handlerCalls);

    const otherPremium = await gateway(request(OTHER_PREMIUM_PATH, token));
    assert.equal(otherPremium.status, 401);
    assert.equal(handlerCalls.other, 0);

    configureGatewayEnv('cloud');
    const cloudCountry = await gateway(request(COUNTRY_BRIEF_PATH, token));
    assert.equal(cloudCountry.status, 401);
    assert.equal(handlerCalls.country, 0);
  });

  it('rejects an invalid Docker session before route execution', async () => {
    configureGatewayEnv('docker');
    installRedisPipelineMock();
    const handlerCalls = { country: 0, other: 0 };

    const response = await makeGateway(handlerCalls)(request(COUNTRY_BRIEF_PATH, 'wms_invalid'));

    assert.equal(response.status, 401);
    assert.equal(handlerCalls.country, 0);
  });

  it('does not let a POST use the GET-only Docker session exception', async () => {
    configureGatewayEnv('docker');
    const redis = installRedisPipelineMock();
    const token = (await issueSessionToken()).token;
    const handlerCalls = { country: 0, other: 0 };

    const response = await makeGateway(handlerCalls)(
      request(COUNTRY_BRIEF_PATH, token, { method: 'POST' }),
    );

    assert.equal(response.status, 401);
    assert.equal(handlerCalls.country, 0);
    assert.deepEqual(redis.directLlmKeys(), []);
  });

  it('enforces the unverified direct-LLM floor in Docker mode', async () => {
    configureGatewayEnv('docker');
    installRedisPipelineMock({ initialDirectLlmCount: 50 });
    const token = (await issueSessionToken()).token;
    const handlerCalls = { country: 0, other: 0 };

    const response = await makeGateway(handlerCalls)(request(COUNTRY_BRIEF_PATH, token));

    assert.equal(response.status, 429);
    assert.equal(handlerCalls.country, 0);
    assert.deepEqual(await response.json(), {
      error: 'Direct LLM daily quota exceeded',
      limit: 50,
      resetsAt: 'next UTC midnight',
    });
  });

  it('rejects a Docker country-brief request with no session token', async () => {
    configureGatewayEnv('docker');
    installRedisPipelineMock();
    const handlerCalls = { country: 0, other: 0 };

    const response = await makeGateway(handlerCalls)(request(COUNTRY_BRIEF_PATH));

    assert.equal(response.status, 401);
    assert.equal(handlerCalls.country, 0);
  });

  it('keys missing X-Real-IP to the shared unknown Docker principal', async () => {
    configureGatewayEnv('docker');
    const redis = installRedisPipelineMock();
    const token = (await issueSessionToken()).token;
    const handlerCalls = { country: 0, other: 0 };

    const response = await makeGateway(handlerCalls)(
      request(COUNTRY_BRIEF_PATH, token, { clientIp: null }),
    );

    assert.equal(response.status, 200);
    assert.equal(handlerCalls.country, 1);
    const directKeys = redis.directLlmKeys();
    assert.equal(directKeys.length, 1);
    assert.ok(
      directKeys[0]?.includes(`docker:${hashKeySync('unknown')}`),
      `expected the unknown Docker principal, got ${directKeys[0] ?? 'none'}`,
    );
  });

  it('keys rotated client X-Real-IP values to distinct Docker principals', async () => {
    configureGatewayEnv('docker');
    const redis = installRedisPipelineMock();
    const token = (await issueSessionToken()).token;
    const handlerCalls = { country: 0, other: 0 };
    const gateway = makeGateway(handlerCalls);

    const first = await gateway(request(COUNTRY_BRIEF_PATH, token, { clientIp: '203.0.113.77' }));
    const second = await gateway(request(COUNTRY_BRIEF_PATH, token, { clientIp: '198.51.100.10' }));

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(handlerCalls.country, 2);
    const directKeys = redis.directLlmKeys();
    assert.equal(directKeys.length, 2);
    assert.ok(directKeys[0]?.includes(`docker:${hashKeySync('203.0.113.77')}`));
    assert.ok(directKeys[1]?.includes(`docker:${hashKeySync('198.51.100.10')}`));
    assert.notEqual(directKeys[0], directKeys[1]);
  });

  it('shares one per-IP quota across rotated Docker sessions', async () => {
    configureGatewayEnv('docker');
    const redis = installRedisPipelineMock({ initialDirectLlmCount: 49 });
    const firstToken = (await issueSessionToken()).token;
    const secondToken = (await issueSessionToken()).token;
    const handlerCalls = { country: 0, other: 0 };
    const gateway = makeGateway(handlerCalls);

    const first = await gateway(request(COUNTRY_BRIEF_PATH, firstToken));
    const second = await gateway(request(COUNTRY_BRIEF_PATH, secondToken));

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(handlerCalls.country, 1);
    const directKeys = redis.directLlmKeys();
    assert.equal(directKeys.length, 2);
    assert.ok(directKeys.every((key) => key.includes(`docker:${hashKeySync(CLIENT_IP)}`)));
    assert.notEqual(firstToken, secondToken);
  });
});


describe('operator-enabled PlanetSlam source-backed panels', () => {
  for (const [path, method] of Object.entries(PLANETSLAM_LOCAL_ANALYSIS_ROUTES)) {
    it(`allows a signed Docker session for ${method} ${path} only after opt-in`, async () => {
      configureGatewayEnv('docker');
      installRedisPipelineMock();
      const token = (await issueSessionToken()).token;
      const calls = { country: 0, other: 0 };
      const gateway = makeGateway(calls);
      const opts = { method: method as 'GET' | 'POST' };
      assert.equal((await gateway(request(path, token, opts))).status, 401);
      process.env.PLANETSLAM_LOCAL_ANALYSIS = 'true';
      assert.equal((await gateway(request(path, token, opts))).status, 401, 'provider must be configured');
      process.env.OPENROUTER_API_KEY = 'synthetic-provider-key';
      assert.equal((await gateway(request(path, 'wms_invalid', opts))).status, 401);
      assert.equal((await gateway(request(path, token, opts))).status, 200);
      assert.equal(calls.other, 1);
      process.env.LOCAL_API_MODE = 'cloud';
      assert.equal((await gateway(request(path, token, opts))).status, 401, 'cloud entitlement stays enforced');
    });
  }
  it('retains per-IP LLM spend limits for source-backed stock analysis', async () => {
    configureGatewayEnv('docker');
    process.env.PLANETSLAM_LOCAL_ANALYSIS = 'true';
    process.env.OPENROUTER_API_KEY = 'synthetic-provider-key';
    installRedisPipelineMock({ initialDirectLlmCount: 50 });
    const calls = { country: 0, other: 0 };
    const response = await makeGateway(calls)(request(OTHER_PREMIUM_PATH, (await issueSessionToken()).token));
    assert.equal(response.status, 429);
    assert.equal(calls.other, 0);
  });
});


it('local analysis handlers independently require the signed self-hosted session', async () => {
  configureGatewayEnv('docker');
  process.env.PLANETSLAM_LOCAL_ANALYSIS = 'true';
  process.env.OPENROUTER_API_KEY = 'synthetic-provider-key';
  const path = '/api/news/v1/summarize-article';
  const token = (await issueSessionToken()).token;
  assert.equal(await isDockerLocalAnalysisSession(request(path, token, { method: 'POST' })), true);
  assert.equal(await isDockerLocalAnalysisSession(request(path, 'wms_invalid', { method: 'POST' })), false);
  assert.equal(await isDockerLocalAnalysisSession(request('/api/latest-brief', token)), false);
  process.env.LOCAL_API_MODE = 'cloud';
  assert.equal(await isDockerLocalAnalysisSession(request(path, token, { method: 'POST' })), false);
});
