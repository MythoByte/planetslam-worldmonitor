import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prioritizeCyber,DEFAULT_PRIORITY_FILTERS,cvssSeverity} from '../src/services/cyber-priorities';
import type {CyberKevItem,CyberEpssData,CyberCvssData} from '../src/types/cyber-dashboard';
const now=Date.now();
const items=[{id:'CVE-2026-11111',vendor:'Docker',product:'Engine',title:'Synthetic',addedAt:now-40*86400000},{id:'CVE-2026-22222',vendor:'Other',product:'Tool',title:'Synthetic',addedAt:now}] as CyberKevItem[];
const epss={items:[{id:items[0].id,probability:0,percentile:0},{id:items[1].id,probability:0.95,percentile:0.99}]} as CyberEpssData;
const cvss={items:[{id:items[0].id,score:9.8}]} as CyberCvssData;
test('watchlist-first and EPSS-first sorting differ; unknown and zero stay separate',()=>{
 const a=prioritizeCyber(items,epss,cvss,['docker']);assert.equal(a[0].item.id,items[0].id);assert.equal(a[0].epss!.probability,0);assert.equal(a[1].severity,'Unknown');
 assert.equal(prioritizeCyber(items,epss,cvss,['docker'],{...DEFAULT_PRIORITY_FILTERS,sort:'epss'})[0].item.id,items[1].id);
 assert.equal(prioritizeCyber(items,null,null,['docker'])[0].epss,null);assert.equal(cvssSeverity(0),'None');assert.equal(cvssSeverity(null),'Unknown');
});
test('vendor, product, severity, query, new additions and watchlist filters use their actual signals',()=>{
 for(const f of [{vendor:'Docker'},{product:'Engine'},{severity:'Critical'},{query:'11111'},{watched:true}]) assert.equal(prioritizeCyber(items,epss,cvss,['docker'],{...DEFAULT_PRIORITY_FILTERS,...f},now)[0].item.id,items[0].id);
 assert.equal(prioritizeCyber(items,epss,cvss,['docker'],{...DEFAULT_PRIORITY_FILTERS,days:'7'},now)[0].item.id,items[1].id);
 assert.equal(prioritizeCyber(items,null,null,[],{...DEFAULT_PRIORITY_FILTERS,severity:'Critical'}).length,0);
});
