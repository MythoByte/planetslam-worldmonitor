import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { parseAttackReports, refreshAttackReports, publishAttackReports, attackReportsSnapshot, REPORT_WINDOW_MS } from '../scripts/_gdelt-attack-reports.mjs';

const now = Date.UTC(2026, 10, 10, 20, 5);
function row(extra = {}) {
  const f = Array(61).fill('');
  Object.assign(f, { 0: '101', 1: '20261110', 25: '1', 26: '195', 29: '4', 33: '4',
    40: '81', 41: '82', 51: '4', 52: 'Tokyo, Japan', 53: 'JA', 56: '35.6', 57: '139.7',
    59: '20261110200000', 60: 'https://example.com/report', ...extra });
  return f.join('\t');
}
function transport(csv, timestamp = '20261110200000') {
  const name = Buffer.from(timestamp + '.export.CSV'); const body = Buffer.from(csv);
  const zip = Buffer.alloc(30 + name.length + body.length);
  zip.writeUInt32LE(0x04034b50,0); zip.writeUInt32LE(body.length,18); zip.writeUInt32LE(body.length,22);
  zip.writeUInt16LE(name.length,26); name.copy(zip,30); body.copy(zip,30+name.length);
  const md5 = createHash('md5').update(zip).digest('hex');
  return async url => String(url).endsWith('masterfilelist.txt')
    ? new Response(`${zip.length} ${md5} http://data.gdeltproject.org/gdeltv2/${timestamp}.export.CSV.zip\n`, { status:206 })
    : new Response(zip);
}

test('maps global CAMEO aerial-use reports with action coordinates and separate dates, without inventing weapon type', () => {
  const [r] = parseAttackReports(row());
  assert.deepEqual([r.latitude,r.longitude], [35.6,139.7]);
  assert.equal(r.locationName,'Tokyo, Japan'); assert.equal(r.eventDate,'2026-11-10');
  assert.equal(r.indexedAt,Date.UTC(2026,10,10,20)); assert.equal(r.verification,'reported');
  assert.equal(r.kind,'aerial'); assert.equal(r.publisher,'example.com');
  assert.equal(r.articleCount,4); assert.equal(r.locationPrecision,'place');
  assert.equal(parseAttackReports(row({51:'5'}))[0].locationPrecision,'region');
});

test('rejects unrelated codes, secondary mentions, malformed dates/coordinates and unsafe source links', () => {
  for (const extra of [{26:'190'},{26:'194'},{25:'0'},{56:''},{57:'181'},{56:'NaN'},
    {1:'20260231'},{59:'20261310200000'},{60:'javascript:alert(1)'},{60:'https://user:secret@example.com/report'}]) {
    assert.equal(parseAttackReports(row(extra)).length,0,JSON.stringify(extra));
  }
  assert.equal(parseAttackReports(row({56:'0',57:'0'})).length,1);
});

test('verified bulk transport merges reports across polls, deduplicates actor pairs, and caps payloads', async () => {
  const previous = { reports: parseAttackReports(row({0:'99',60:'https://example.com/earlier'})), coverageStart: now - 3*3600000 };
  const s = await refreshAttackReports(previous, { now, fetchImpl: transport(row()+'\n'+row({0:'102'})) });
  assert.equal(s.reports.length,2); assert.equal(s.status,'fresh'); assert.equal(s.exportsSucceeded,1);
  assert.equal(s.completeWindow,false); assert.equal(s.updatedAt,now);
  const capped = await refreshAttackReports(null,{now,fetchImpl:transport(Array.from({length:510},(_,i)=>row({0:String(i+1),60:`https://example.com/report-${i}`})).join('\n'))});
  assert.equal(capped.reports.length,500); assert.equal(capped.limited,true);
});

test('outages retain cached reports as stale, old/historical events expire, and a valid empty batch is distinct', async () => {
  const previous = await refreshAttackReports(null,{now,fetchImpl:transport(row())});
  await assert.rejects(refreshAttackReports(previous,{now,fetchImpl:async()=>{throw new Error('offline');}}),/offline/);
  assert.equal(previous.updatedAt,now);
  assert.equal(attackReportsSnapshot(previous,now+46*60_000).status,'stale');
  assert.equal(attackReportsSnapshot(previous,now+REPORT_WINDOW_MS+1).reports.length,0);
  const old = await refreshAttackReports(null,{now,fetchImpl:transport(row({1:'20200101'}))});
  assert.equal(old.reports.length,0);
  const empty = await refreshAttackReports(null,{now,fetchImpl:transport(row({26:'190'}))});
  assert.equal(empty.status,'fresh'); assert.equal(empty.reports.length,0);
  assert.equal(attackReportsSnapshot(null,now).status,'unavailable');
  await assert.rejects(refreshAttackReports(null,{now:now+3600000,fetchImpl:transport(row())}),/stale/);
});

test('activation follows successful data and metadata writes, including valid empty batches; failures never activate', async () => {
  for (const failAt of ['none','snapshot','meta','activate','stale']) {
    const calls = [];
    const result = await publishAttackReports({ status: failAt === 'stale' ? 'stale' : 'fresh', reports: [], updatedAt: now }, {
      writeSnapshot: async () => { calls.push('snapshot'); return failAt !== 'snapshot'; },
      writeMeta: async meta => { calls.push('meta'); assert.equal(meta.recordCount,0); return failAt !== 'meta'; },
      activate: async timestamp => { calls.push('activate'); assert.equal(timestamp,now); return failAt !== 'activate'; },
    });
    assert.equal(result,failAt === 'none');
    assert.deepEqual(calls,failAt === 'stale' ? [] : failAt === 'snapshot' ? ['snapshot'] : failAt === 'meta' ? ['snapshot','meta'] : ['snapshot','meta','activate']);
  }
});


test('relay activation uses durable SET without EVAL; regular seeds keep TTL and failed writes stay false', async () => {
  const relay = readFileSync(new URL('../scripts/ais-relay.cjs', import.meta.url), 'utf8');
  const writer = relay.slice(relay.indexOf('function upstashSet('), relay.indexOf('function upstashExpire('));
  const calls = [];
  let reply = 'OK';
  const set = runInNewContext(writer + '; upstashSet', {
    URL, UPSTASH_ENABLED: true, UPSTASH_REDIS_REST_URL: 'http://redis.test', UPSTASH_REDIS_REST_TOKEN: 'synthetic',
    UPSTASH_HTTP_MODULE: { request(_url, _options, onResponse) {
      const req = new EventEmitter();
      req.end = body => { calls.push(JSON.parse(body)); const res = new EventEmitter(); onResponse(res); res.emit('data', JSON.stringify({ result: reply })); res.emit('end'); };
      return req;
    } },
  });
  assert.equal(await set('seed-activated:gdelt:attack-reports', now), true);
  assert.deepEqual(calls[0], ['SET', 'seed-activated:gdelt:attack-reports', String(now)]);
  assert.equal(await set('snapshot', { fresh: true }, 900), true);
  assert.deepEqual(calls[1], ['SET', 'snapshot', '{"fresh":true}', 'EX', '900']);
  reply = null; assert.equal(await set('marker', now), false);
  assert.match(relay, /activate: fetchedAt => upstashSet\(attackReportModule\.ATTACK_REPORT_ACTIVATION_KEY, fetchedAt\)/);
});


test('relay immediately retries an incomplete activation and throttles an activated feed on boot', async () => {
  const relay = readFileSync(new URL('../scripts/ais-relay.cjs', import.meta.url), 'utf8');
  const start = relay.slice(relay.indexOf('async function startAttackReportsLoop('), relay.indexOf('function startMiddleEastStrikesLoop('));
  for (const active of [null, now]) {
    let scheduled;
    const run = runInNewContext(start + '; startAttackReportsLoop', {
      upstashGet: async key => { assert.equal(key, 'seed-activated:gdelt:attack-reports'); return active; },
      startBootSeedLoop: (...args) => { scheduled = args; }, seedAttackReports() {}, console,
    });
    await run(); assert.equal(scheduled[1], active ? 'seed-meta:gdelt:attack-reports' : null); assert.equal(scheduled[2], 900000);
  }
});
