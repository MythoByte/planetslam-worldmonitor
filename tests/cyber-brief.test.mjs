import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCyberBrief,applyCyberBriefAi,generateCyberBrief} from '../scripts/_cyber-brief.mjs';
import {validCyberBrief,projectCyberBrief,CYBER_BRIEF_INPUTS} from '../api/_cyber-brief.js';
import {cyberEnvelope,cyberKey} from '../api/_cyber-data.js';
import {seedCyber} from '../scripts/seed-cyber-dashboard.mjs';
const now=Date.parse('2026-11-07T01:00:00Z'),publishedAt=now-4*3600000;
const news={dataset:'bleeping',fetchedAt:now,observedAt:publishedAt,data:{items:[{id:'n1',title:'Synthetic Docker security update',summary:'Synthetic publisher describes a Docker update. This is fixture reporting.',publishedAt,publisher:'Synthetic publisher',topic:'Security',url:'https://example.org/docker'}]}};
const kev={dataset:'kev',fetchedAt:now,observedAt:publishedAt,data:{items:[{id:'CVE-2026-99999',vendor:'Synthetic',product:'Docker',title:'Fixture',description:'Synthetic exploitation evidence.',action:'Apply the vendor update.',addedAt:Date.parse('2026-11-06'),dueDate:'2026-11-20',ransomware:'Unknown',url:'https://example.org/cve',references:[]}],totalCount:1,catalogAt:publishedAt,version:'synthetic'}};
function envelopes(extra={}){return Object.fromEntries(CYBER_BRIEF_INPUTS.map(n=>[n,cyberEnvelope(n,({bleeping:news,kev,...extra})[n],now)]));}
function base(){return buildCyberBrief(envelopes(),now);}
function cache(initial={}){
 const values=new Map(Object.entries({[cyberKey('bleeping')]:news,[cyberKey('kev')]:kev,...initial})),tickets=new Set(),calls=[];
 return {values,calls,command:async args=>{calls.push(args);if(args[0]==='GET')return {result:values.has(args[1])?JSON.stringify(values.get(args[1])):null};if(args[0]==='SET'){if(tickets.has(args[1]))return {result:null};tickets.add(args[1]);return {result:'OK'};}throw Error('Unexpected command');}};
}
test('brief captures a fixed previous UTC day, original URLs, immutable excerpts and all source gaps',()=>{
 const b=base();assert.equal(validCyberBrief(b),true);assert.equal(b.date,'2026-11-07');assert.equal(b.periodStart,Date.parse('2026-11-06'));assert.equal(b.periodEnd,Date.parse('2026-11-07'));
 assert.equal(b.mode,'source-summary');assert.equal(b.items.length,2);assert.equal(b.coverage.length,5);assert.equal(b.coverage.find(c=>c.dataset==='krebs').status,'unavailable');
 assert.equal(b.candidates[0].url,'https://example.org/docker');assert.equal(b.candidates[0].facts.map(f=>f.text).join(' '),news.data.items[0].summary);
 assert.equal(buildCyberBrief(envelopes({bleeping:null,kev:null}),now),null);
 const old=structuredClone(news);old.data.items[0].publishedAt=Date.parse('2026-11-05');assert.equal(buildCyberBrief(envelopes({bleeping:old,kev:null}),now),null);
 const future=structuredClone(news);future.data.items[0].publishedAt=Date.parse('2026-11-07T00:30:00Z');assert.equal(buildCyberBrief(envelopes({bleeping:future,kev:null}),now),null);
});
test('AI selects only bound evidence/fact IDs; generated prose, invented IDs, duplicate selections and new URLs are rejected',()=>{
 const b=base(),good={items:b.items};const curated=applyCyberBriefAi(b,JSON.stringify(good),'synthetic-model');
 assert.equal(curated.mode,'ai-curated');assert.deepEqual(curated.candidates,b.candidates);assert.deepEqual(curated.coverage,b.coverage);
 for(const bad of [{items:[{id:'e1',factIds:['invented']}]},{items:[{id:'e1',factIds:['f1'],summary:'Invented compromise'}]},{items:[{id:'e99',factIds:['f1']}]},{items:[b.items[0],b.items[0]]},{items:[],url:'https://evil.example'}])assert.equal(applyCyberBriefAi(b,JSON.stringify(bad),'synthetic-model'),null);
});
test('reader ages original source clocks and brief generation independently of a copied fetch time',()=>{
 const b=base(),snap={dataset:'brief',data:b,fetchedAt:now};
 assert.equal(projectCyberBrief(snap,now).status,'fresh');
 const delayed=projectCyberBrief(snap,now+8*3600000);assert.equal(delayed.data.candidates[0].status,'unavailable');assert.equal(delayed.data.candidates[0].publishedAt,publishedAt);
 assert.equal(projectCyberBrief(snap,now+DAY).status,'stale');
 assert.equal(projectCyberBrief({...snap,fetchedAt:now+49*3600000},now+49*3600000).data,null);
 for(const patch of [b=>{b.candidates=[null];},b=>{b.items[0].factIds=['invented'];},b=>{b.candidates[0].url='javascript:alert(1)';},b=>{b.coverage[0].dataset='invented';},b=>{b.date='2026-01-01';}]){const d=structuredClone(b);patch(d);assert.equal(validCyberBrief(d),false);assert.equal(projectCyberBrief({...snap,data:d},now).data,null);}
});
const DAY=86400000;
test('AI attempt admission is shared per UTC day; failure returns a labeled source digest and current cache skips calls',async()=>{
 const c=cache();let calls=0;
 const options={...c,now,aiEnabled:true,model:'synthetic-model',llm:async()=>{calls++;throw Error('Synthetic provider outage');}};
 const first=await generateCyberBrief(options);assert.equal(first.data.mode,'source-summary');assert.equal(first.data.aiStatus,'failed');assert.equal(calls,1);
 const second=await generateCyberBrief(options);assert.equal(second.data.aiStatus,'admission-used');assert.equal(calls,1);
 c.values.set(cyberKey('brief'),{dataset:'brief',fetchedAt:now,data:first.data});assert.deepEqual(await generateCyberBrief(options),{skipped:'current'});assert.equal(calls,1);
 assert.ok(c.calls.filter(a=>a[0]==='GET').every(a=>a[1].startsWith('cyber-dashboard:')));
});
test('prompt excludes browser preferences and source URLs; model output never becomes new prose',async()=>{
 const c=cache();const r=await generateCyberBrief({...c,now,aiEnabled:true,model:'synthetic-model',llm:async(system,prompt,opts)=>{
  const value=JSON.parse(prompt);assert.equal('watchlist' in value,false);assert.ok(!prompt.includes('https://'));assert.deepEqual(opts.allowedProviders,['openrouter']);
  return JSON.stringify({items:value.evidence.slice(0,2).map(i=>({id:i.id,factIds:[i.facts[0].id]}))});
 }});assert.equal(r.data.mode,'ai-curated');
});
test('worker brief failure preserves last-good data and successful publish retains generated time',async(t)=>{
 t.mock.method(Date,'now',()=>now);
 let writes=0;const options={names:['brief'],now,command:async()=>({result:'OK'}),lock:async()=>true,unlock:async()=>{},publish:async()=>writes++,generateBrief:async()=>{throw Error('No evidence');}};
 assert.equal((await seedCyber(options))[0].status,'failed');assert.equal(writes,0);
 assert.equal((await seedCyber({...options,generateBrief:async()=>({data:base(),observedAt:now})}))[0].status,'published');assert.equal(writes,1);
});
test('older monthly incident research remains labeled context and cannot be the sole daily evidence',()=>{
 const old=now-40*DAY;
 const incident={dataset:'incidents',fetchedAt:now,observedAt:old,data:{coverage:'Public recent-record sample; monthly research updates',items:[{id:'fixture-old',organization:'Synthetic Organization',country:'Undetermined',countryCode:'unknown',sector:'Unknown',category:'Unspecified',description:'An unverified synthetic research report.',eventAt:old,reportedAt:old,updatedAt:null,verification:'claim-reported',latitude:null,longitude:null,url:'https://example.org/research',reportUrl:'',changeLog:''}]}};
 const full=buildCyberBrief(envelopes({incidents:incident}),now);assert.equal(full.candidates.find(c=>c.kind==='research').publishedAt,old);
 assert.equal(buildCyberBrief(envelopes({bleeping:null,kev:null,incidents:incident}),now),null);
 const forged=structuredClone(full);forged.items=[{id:full.candidates.find(c=>c.kind==='research').id,factIds:['f1']}];assert.equal(validCyberBrief(forged),false);
});
