import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyResearchStore,captureResearch as evaluateCapture,parseResearchStore,retainedResearch,filterResearch,researchGroups,relatedResearchNews,saveResearchInvestigation,researchCsv,researchJson,RESEARCH_RETENTION} from '../src/services/cyber-research-model';
import type {CyberEnvelope,CyberIncident,CyberIncidentData,CyberNewsItem} from '../src/types/cyber-dashboard';
const now=Date.parse('2026-11-07T01:00:00Z'),DAY=86400000;
const captureResearch=(s:ReturnType<typeof emptyResearchStore>,e:CyberEnvelope<CyberIncidentData>,at=now)=>evaluateCapture(s,e,at);
const item=(id='i1',patch:Partial<CyberIncident>={}):CyberIncident=>({id,organization:'Synthetic Hospital',country:'United States',countryCode:'US',sector:'Healthcare',category:'Encryption',description:'Synthetic source claim, not an actual incident.',eventAt:now-DAY,reportedAt:now-DAY,updatedAt:now-1000,verification:'claim-reported',latitude:40,longitude:-100,url:'https://example.org/record',reportUrl:'https://example.org/report',changeLog:'',...patch});
const wrap=(items=[item()],at=now):CyberEnvelope<CyberIncidentData>=>({dataset:'incidents',status:'fresh',provider:'Synthetic',sourceUrl:'https://example.org',fetchedAt:at,observedAt:at,expiresAt:at+DAY,data:{items,coverage:'Public recent-record sample; monthly research updates'}});
const article=(patch:Partial<CyberNewsItem>={}):CyberNewsItem=>({id:'n1',title:'Synthetic Hospital reporting',summary:'Synthetic text',publisher:'Synthetic',url:'https://example.org/news',publishedAt:now-5000,topic:'breach',...patch});
test('captures unique incident history, retains records missing from later samples, and preserves meaningful revisions across reload',()=>{
 const a=captureResearch(emptyResearchStore(),wrap());assert.equal(a.records.length,1);assert.equal(a.firstCaptureAt,now);assert.equal(a.records[0].revisions.length,0);
 const b=captureResearch(a,wrap([item('i1',{description:'New reported detail'}),item('i2')],now+1000),now+1000);
 assert.equal(b.records.length,2);assert.deepEqual(b.records.find(r=>r.incident.id==='i1')!.revisions[0].fields,['description']);
 const c=captureResearch(b,wrap([item('i2')],now+2000),now+2000);assert.equal(c.records.length,2);assert.equal(c.records.find(r=>r.incident.id==='i1')!.firstSeenAt,now);
 assert.deepEqual(parseResearchStore(JSON.stringify(c),now+2000),c);
});
test('timestamp-only refreshes do not create source changes; stale, expired, failed and out-of-order samples cannot rewrite history',()=>{
 const a=captureResearch(emptyResearchStore(),wrap());const b=captureResearch(a,wrap([item('i1',{updatedAt:now+1000})],now+1000),now+1000);assert.equal(b.records[0].revisions.length,0);
 for(const e of [{...wrap([item('i2')]),status:'stale' as const},{...wrap([item('i2')]),expiresAt:now-1},{...wrap(),data:null},{...wrap(),fetchedAt:now-10000}]){
  assert.deepEqual(captureResearch(b,e,now+2000),b);
 }
 const paused={...a,captureEnabled:false};assert.deepEqual(captureResearch(paused,wrap([item('i2')])),paused);
});
test('record/age/revision bounds retain frozen investigations independently',()=>{
 let s=emptyResearchStore();for(let batch=0;batch<11;batch++)s=captureResearch(s,wrap(Array.from({length:20},(_,j)=>item(`id-${batch}-${j}`)),now+batch),now+batch);
 assert.equal(s.records.length,200);
 s=saveResearchInvestigation(s,s.records[0]!,[], 'case-1',now+100);
 assert.equal(retainedResearch(s,now+RESEARCH_RETENTION+1000).records.length,0);assert.equal(retainedResearch(s,now+RESEARCH_RETENTION+1000).investigations.length,1);
 let r=captureResearch(emptyResearchStore(),wrap());for(let n=1;n<9;n++)r=captureResearch(r,wrap([item('i1',{description:`Revision ${n}`})],now+n),now+n);assert.equal(r.records[0].revisions.length,5);
});
test('filters and country/sector/UTC-week counts describe distinct observed records, preserving unknown countries',()=>{
 const s=captureResearch(emptyResearchStore(),wrap([item(),item('i2',{countryCode:'unknown',country:'Unknown',sector:'Unknown',reportedAt:now-60*DAY})]));
 assert.equal(filterResearch(s.records,{country:'US',sector:'Healthcare',days:30,query:'hospital'},now).length,1);
 assert.equal(filterResearch(s.records,{country:'',sector:'',days:30,query:''},now).length,1);
 assert.deepEqual(researchGroups(s.records,'sector'),[['Healthcare',1],['Unknown',1]]);
 const weeks=researchGroups(s.records,'week');assert.equal(weeks.length,2);assert.equal(weeks[0]![0],'2026-11-02');
 assert.equal(researchGroups(s.records,'country').reduce((n,r)=>n+r[1],0),2);
});
test('related reporting requires a literal organization boundary, excludes generic names, old/unsafe links, and deduplicates tracking URLs',()=>{
 const rows=[article(),article({id:'n2',url:'https://example.org/news?utm_source=test'}),article({id:'n3',title:'Synthetic Hospitals report'}),article({id:'n4',publishedAt:now-8*DAY}),article({id:'n5',url:'javascript:alert(1)'})];
 assert.equal(relatedResearchNews(item(),rows,now).length,1);assert.equal(relatedResearchNews(item('i1',{organization:'Unknown'}),rows,now).length,0);
 assert.equal(relatedResearchNews(item('i1',{organization:'Acme [Research]'}),[article({title:'Acme [Research] report'})],now).length,1);
});
test('investigations pin source snapshots; JSON preserves notes and provenance, CSV mitigates formulas and quotes embedded separators/newlines',()=>{
 const s=captureResearch(emptyResearchStore(),wrap([item('i1',{organization:' =HYPERLINK("x")',description:'Comma, and "quotes"\nnext line'})]));
 const saved=saveResearchInvestigation(s,s.records[0]!,[article()],'case-1',now,now-1000);saved.investigations[0]!.notes='Private investigation note';
 const updated=captureResearch(saved,wrap([item('i1',{description:'Changed'})],now+1000),now+1000);
 assert.equal(updated.investigations[0]!.evidence.incident.description,'Comma, and "quotes"\nnext line');
 const exported=JSON.parse(researchJson(updated.investigations[0]!,now));assert.equal(exported.investigation.notes,'Private investigation note');assert.match(exported.coverage,/Not global/);assert.equal(exported.investigation.relatedFetchedAt,now-1000);
 const csv=researchCsv(saved.records);assert.match(csv,/' =HYPERLINK/);assert.match(csv,/""quotes""/);assert.match(csv,/claim-reported/);assert.match(csv,/first_observed_utc/);assert.doesNotMatch(csv,/Private investigation note/);
 assert.throws(()=>saveResearchInvestigation(saved,s.records[0]!,[],'case-2',now),/already/);
});
test('malformed state, unsafe links and oversized stores fail closed',()=>{
 const s=captureResearch(emptyResearchStore(),wrap());assert.ok(parseResearchStore(JSON.stringify(s),now));
 for(const x of [{...s,records:null},{...s,captureEnabled:'yes'},{...s,records:[s.records[0],s.records[0]]},{...s,records:[{...s.records[0],incident:{...item(),url:'https://secret:token@example.org'}}]}])assert.equal(parseResearchStore(JSON.stringify(x),now),null);
 assert.equal(parseResearchStore('x'.repeat(2000001),now),null);assert.equal(parseResearchStore('{'),null);
 assert.equal(captureResearch(emptyResearchStore(),wrap([item('i1',{url:'javascript:alert(1)'})])).records.length,0);
});
