import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {epssParser, fetchEpss, normalizeCvss, fetchCvss} from '../scripts/_cyber-priority.mjs';
import {cyberEnvelope} from '../api/_cyber-data.js';
import {seedCyber} from '../scripts/seed-cyber-dashboard.mjs';
const now=Date.now(), date=new Date(now).toISOString().slice(0,10), at=Date.parse(date+'T00:00:00Z');
const kev={fetchedAt:now,data:{items:[{id:'CVE-2026-99999'}]}};
const text=`#model_version:synthetic,score_date:${date}\ncve,epss,percentile\nCVE-2026-99999,0,0.1\nCVE-2020-1234,0.2,0.5\n`;
function parse(s){const p=epssParser(kev,now);s.trimEnd().split('\n').forEach(p.line);return p.finish();}
test('EPSS parses daily metadata, retains real zero and omits uncovered IDs without inventing scores',()=>{
 const r=parse(text);assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].probability,0);assert.equal(r.observedAt,at);
 for(const bad of [text.replace(',0,0.1',',NaN,0.1'),text.replace(',0,0.1',',1.1,0.1'),text+`CVE-2026-99999,0.5,0.5\n`,text.replace(date,'2099-01-01'),text.replace('cve,epss,percentile','html')]) assert.throws(()=>parse(bad));
});
test('EPSS source publication age cannot be reset by fetching again',()=>{
 const r=parse(text), snap={dataset:'epss',fetchedAt:now,observedAt:at,data:r.data};
 assert.equal(cyberEnvelope('epss',snap,now).status,'fresh');
 const old=at-3*86400000, stale={...snap,data:{...r.data,scoreDate:new Date(old).toISOString().slice(0,10)},observedAt:old};
 assert.equal(cyberEnvelope('epss',stale,now).status,'stale');
 assert.equal(cyberEnvelope('epss',{...stale,fetchedAt:now+5*86400000},now+5*86400000).data,null);
 assert.equal(cyberEnvelope('epss',{...snap,observedAt:at-1},now).data,null);
});
const record=(metrics)=>({cveMetadata:{cveId:'CVE-2026-99999',state:'PUBLISHED',dateUpdated:new Date(now).toISOString()},containers:{cna:{providerMetadata:{shortName:'Synthetic CNA'},metrics}}});
const metric=(score,version='3.1')=>({['cvssV'+version.replace('.','_')]:{baseScore:score,vectorString:`CVSS:${version}/AV:N`}});
test('CVSS preserves contributor/version/vector, prefers newest CNA metric and leaves unscored records unknown',()=>{
 const r=normalizeCvss(record([metric(9.8),metric(8,'4.0')]),'CVE-2026-99999',now);assert.equal(r.score,8);assert.equal(r.version,'4.0');assert.equal(r.provider,'Synthetic CNA');
 assert.equal(normalizeCvss(record([]),'CVE-2026-99999',now).score,null);
 assert.equal(normalizeCvss(record([{...metric(10),scenarios:[{value:'specific configuration'}]}]),'CVE-2026-99999',now).score,null);
 assert.throws(()=>normalizeCvss(record([metric(11)]),'CVE-2026-99999',now));
 assert.throws(()=>normalizeCvss(record([]),'CVE-2020-1234',now));
});
test('provider failure retains last-good enrichment and original clock',async()=>{
 let writes=0;const result=await seedCyber({names:['epss','cvss'],now,command:async()=>({result:'OK'}),lock:async()=>true,unlock:async()=>{},fetchDataset:async()=>{throw Error('synthetic');},publish:async()=>writes++});
 assert.equal(writes,0);assert.deepEqual(result.map(i=>i.status),['failed','failed']);
});
test('EPSS requires an available KEV cache before requesting any provider',async()=>{
 let calls=0;await assert.rejects(fetchEpss({command:async()=>({result:null}),fetchFn:async()=>{calls++;return new Response(gzipSync(text));},now}));assert.equal(calls,0);
});

test('EPSS accepts provider scientific notation and validates a streamed gzip response', async()=>{
 assert.equal(parse(text.replace(',0,0.1', ',0,5e-05')).data.items[0].percentile,0.00005);
 const item={id:'CVE-2026-99999',vendor:'Synthetic',product:'Fixture',title:'Test',description:'Test',action:'Update',addedAt:now,dueDate:'2026-11-20',ransomware:'Unknown',url:'https://example.com',references:[]};
 const snapshot={dataset:'kev',fetchedAt:now,observedAt:now,data:{items:[item],totalCount:1,catalogAt:now,version:'synthetic'}};
 const command=async()=>({result:JSON.stringify(snapshot)});
 const r=await fetchEpss({command,fetchFn:async()=>new Response(gzipSync(text)),now});assert.equal(r.data.items.length,1);
 await assert.rejects(fetchEpss({command,fetchFn:async()=>new Response('not gzip'),now}));
});
test('CVSS collector caps coverage at forty newest KEV additions, with at most two simultaneous reads',async()=>{
 const items=Array.from({length:45},(_,n)=>({id:`CVE-2026-${10000+n}`,vendor:'Synthetic',product:'Fixture',title:'Test',description:'Test',action:'Update',addedAt:now-n*86400000,dueDate:'2026-11-20',ransomware:'Unknown',url:'https://example.com',references:[]}));
 const snapshot={dataset:'kev',fetchedAt:now,observedAt:now,data:{items,totalCount:45,catalogAt:now,version:'synthetic'}};
 const seen=[];let active=0,peak=0;
 const r=await fetchCvss({now,command:async()=>({result:JSON.stringify(snapshot)}),readJson:async url=>{
  active++;peak=Math.max(peak,active);await Promise.resolve();const id=url.split('/').pop();seen.push(id);active--;
  return {...record([metric(7.5)]),cveMetadata:{...record([]).cveMetadata,cveId:id}};
 }});
 assert.equal(r.data.items.length,40);assert.equal(seen.length,40);assert.ok(peak<=2);assert.ok(!seen.includes(items[44].id));
});

test('corrupt enrichment rows fail closed as unavailable rather than throwing from the cache reader',()=>{
 for(const name of ['epss','cvss']) {
  const data=name==='epss'?parse(text).data:{catalogFetchedAt:now,items:[]};
  const snapshot={dataset:name,fetchedAt:now,observedAt:at,data:{...data,items:[null]}};
  assert.equal(cyberEnvelope(name,snapshot,now).status,'unavailable');
 }
});
