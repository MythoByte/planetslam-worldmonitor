import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCyberAlerts,freshCyberAlertStore,parseCyberAlertStore} from '../src/services/cyber-alert-engine';
import type {CyberAlertInputs,CyberAlertStore} from '../src/services/cyber-alert-engine';
const now=Date.parse('2026-11-07T01:00:00Z'),DAY=86400000;
const wrap=(dataset:string,data:unknown)=>({dataset,status:'fresh' as const,provider:'Synthetic',sourceUrl:'https://example.org',fetchedAt:now,observedAt:now,expiresAt:now+3*DAY,data});
const item=(id='CVE-2026-99999')=>({id,vendor:'Docker',product:'Engine',title:'Synthetic vulnerability',url:'https://example.org/cve'});
const incident=(description='Synthetic report')=>({id:'i1',organization:'Synthetic Hospital',category:'Encryption',countryCode:'US',sector:'Healthcare',description,verification:'reported',eventAt:now-DAY,reportedAt:now-DAY,reportUrl:'https://example.org/report',url:'https://example.org/record',changeLog:'',updatedAt:now});
const health=(status:string)=>wrap('health',{items:[{dataset:'bleeping',provider:'Synthetic news',status,sourceUrl:'https://example.org/feed'}]});
function start(rules={}){const s=freshCyberAlertStore();s.rules={...s.rules,enabled:true,...rules};return s;}
const run=(s:CyberAlertStore,input:CyberAlertInputs,at=now)=>evaluateCyberAlerts(s,input,['docker'],at);
test('first observation establishes baselines; new qualifying KEV entries create one local alert and reload dedupes',()=>{
 const baseline=run(start(),{kev:wrap('kev',{items:[item()]})});assert.equal(baseline.added.length,0);
 const next=run(baseline.store,{kev:wrap('kev',{items:[item(),item('CVE-2026-88888')]})},now+60000);assert.equal(next.added.length,1);assert.equal(next.added[0].kind,'vulnerability');
 const saved=parseCyberAlertStore(JSON.stringify(next.store),now+60000);assert.ok(saved);assert.equal(run(saved!,{kev:wrap('kev',{items:[item(),item('CVE-2026-88888')]})},now+120000).added.length,0);
});
test('EPSS and severity thresholds require known fresh scores; missing feeds preserve a qualified baseline',()=>{
 const inputs={kev:wrap('kev',{items:[item()]}),epss:wrap('epss',{items:[{id:item().id,probability:0.05}]}),cvss:wrap('cvss',{items:[{id:item().id,score:9.8}]})};
 const first=run(start({epssMin:10,cvssMin:9}),inputs);
 const unavailable=run(first.store,{...inputs,epss:{...inputs.epss,status:'unavailable',data:null}},now+60000);assert.deepEqual(unavailable.store.kev,first.store.kev);assert.equal(unavailable.added.length,0);
 const crossed=run(unavailable.store,{...inputs,epss:wrap('epss',{items:[{id:item().id,probability:0.72}]})},now+120000);assert.equal(crossed.added.length,1);
 const unknown=run(start({epssMin:10}),{kev:inputs.kev,epss:wrap('epss',{items:[]})});assert.equal(unknown.store.kev?.[0][1],false);
});
test('watchlist/rule changes rebaseline rather than announce old entries; disabled monitoring stays quiet',()=>{
 const first=run(start(),{kev:wrap('kev',{items:[item()]})});
 const changed=evaluateCyberAlerts(first.store,{kev:wrap('kev',{items:[item(),item('CVE-2026-88888')]})},['microsoft'],now+60000);assert.equal(changed.added.length,0);
 changed.store.rules.enabled=false;assert.equal(run(changed.store,{kev:wrap('kev',{items:[item()]})}).added.length,0);
});
test('incident timestamps alone do not alert; meaningful research revisions do, without claiming live attacks',()=>{
 const first=run(start(),{incidents:wrap('incidents',{items:[incident()]})});assert.equal(first.added.length,0);
 const clock=run(first.store,{incidents:wrap('incidents',{items:[{...incident(),updatedAt:now+50000}]})},now+60000);assert.equal(clock.added.length,0);
 const changed=run(clock.store,{incidents:wrap('incidents',{items:[incident('Synthetic revised research description')]})},now+120000);assert.equal(changed.added.length,1);assert.match(changed.added[0].message,/Monthly research sample/);
 assert.equal(run(changed.store,{incidents:wrap('incidents',{items:[incident('Synthetic revised research description')]})},now+180000).added.length,0);
});
test('source quality transitions and recoveries require consecutive confirmation, including all-unavailable health responses',()=>{
 const first=run(start(),{health:health('fresh')});const one=run(first.store,{health:health('unavailable')},now+60000);assert.equal(one.added.length,0);
 const two=run(one.store,{health:{...health('unavailable'),status:'unavailable'}},now+120000);assert.equal(two.added.length,1);assert.match(two.added[0].title,/unavailable/);
 const recovery1=run(two.store,{health:health('fresh')},now+180000);assert.equal(recovery1.added.length,0);
 const recovery2=run(recovery1.store,{health:health('fresh')},now+240000);assert.equal(recovery2.added.length,1);assert.match(recovery2.added[0].title,/recovered/);
});
test('daily digest is scheduled after initialization, catches up once and never interprets no alerts as safety',()=>{
 const first=run(start({digestHour:8}),{});assert.equal(first.store.nextDigestAt,Date.parse('2026-11-07T08:00:00Z'));
 const digest=run(first.store,{},Date.parse('2026-11-07T08:05:00Z'));assert.equal(digest.added.length,1);assert.equal(digest.added[0].kind,'digest');assert.match(digest.added[0].message,/not proof of safety/);
 assert.equal(run(digest.store,{},Date.parse('2026-11-07T09:00:00Z')).added.length,0);
 assert.ok(parseCyberAlertStore(JSON.stringify(digest.store),Date.parse('2026-11-07T09:00:00Z')));
});
test('malformed persisted history, unsafe links, null ledgers and oversized state fail closed',()=>{
 const good=freshCyberAlertStore();assert.ok(parseCyberAlertStore(JSON.stringify(good),now));
 for(const mutate of [(s:any)=>s.seen=null,(s:any)=>s.pending=null,(s:any)=>s.events=[{id:'x',kind:'source',title:'Test',message:'Test',url:'javascript:alert(1)',at:now,read:false}],(s:any)=>s.kev=[['__proto__',true]]]){const s=structuredClone(good);mutate(s);assert.equal(parseCyberAlertStore(JSON.stringify(s),now),null);}
 assert.equal(parseCyberAlertStore('x'.repeat(2000001),now),null);
});

test('changing a digest schedule after today was delivered cannot trigger an early digest at midnight',()=>{
 const first=run(start({digestHour:8}),{});const done=run(first.store,{},Date.parse('2026-11-07T08:05:00Z')).store;
 done.nextDigestAt=Date.parse('2026-11-07T09:00:00Z');
 const skipped=run(done,{},Date.parse('2026-11-07T09:05:00Z'));assert.equal(skipped.added.length,0);assert.equal(skipped.store.nextDigestAt,Date.parse('2026-11-08T08:00:00Z'));
 assert.equal(run(skipped.store,{},Date.parse('2026-11-08T00:05:00Z')).added.length,0);
});
