import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNws, normalizeNwsCancellations, normalizeEonetClosed, fetchEarthSource } from '../scripts/_earth-providers.mjs';
import { validEarthData, earthEnvelope } from '../api/_earth-data.js';
const now=Date.now(),iso=new Date(now).toISOString();
const cancellation = (patch={}) => ({id:'https://api.weather.gov/alerts/new',geometry:null,properties:{id:'new',status:'Actual',messageType:'Cancel',event:'Flood Warning',sent:iso,expires:new Date(now-1).toISOString(),'@id':'https://api.weather.gov/alerts/new',references:[{identifier:'old'}],description:'Warning replaced; no recovery inferred.',severity:'Minor',...patch}});
const nws = rows => ({type:'FeatureCollection',updated:iso,features:rows});
const eonet = patch => ({id:'closed-event',title:'Synthetic wildfire',closed:iso,categories:[{id:'wildfires'}],link:'https://eonet.gsfc.nasa.gov/api/v3/events/closed-event',sources:[],geometry:[{type:'Point',coordinates:[0,0],date:iso}],...patch});
test('NWS cancellations preserve CAP references and survive original message expiry without becoming live warnings',()=>{
 const out=normalizeNwsCancellations(nws([cancellation()]),now), event=out.data.items[0];
 assert.equal(event.lifecycle,'cancelled');assert.equal(event.id,'nws:new');assert.deepEqual(event.supersedes,['nws:old']);assert.equal(event.expiresAt,null);assert.equal(event.latitude,null);assert.equal(event.mode,'observed');
 assert.equal(validEarthData('nws-cancel',out.data),true);
 const data=earthEnvelope('changes',{'nws-cancel':{sourceId:'nws-cancel',dataset:'changes',fetchedAt:now,observedAt:now,data:out.data}},now);
 assert.equal(data.data.items.length,1);assert.equal(data.data.items[0].lifecycle,'cancelled');
 assert.equal(earthEnvelope('alerts',{},now).data.items.length,0);
});
test('active NWS updates retain predecessor identities while cancelled notices stay out of active alerts',()=>{
 const update=cancellation({messageType:'Update',expires:new Date(now+3600_000).toISOString()});
 const out=normalizeNws(nws([update,cancellation()]),now);
 assert.equal(out.data.items.length,1);assert.deepEqual(out.data.items[0].supersedes,['nws:old']);assert.equal(out.data.items[0].lifecycle,undefined);
});
test('terminal feeds reject missing identities, absent references, malformed generation and overbound pages',()=>{
 assert.throws(()=>normalizeNwsCancellations(nws([cancellation({references:[]})]),now));
 assert.throws(()=>normalizeNwsCancellations(nws([cancellation({messageType:'Alert'})]),now));
 assert.throws(()=>normalizeNwsCancellations({...nws([]),updated:new Date(now+61_000).toISOString()},now));
 assert.throws(()=>normalizeNwsCancellations(nws(Array.from({length:501},()=>cancellation())),now));
 assert.throws(()=>normalizeEonetClosed({events:[eonet({closed:null})]},now));
});
test('EONET closure preserves stable identity and actual closure time, with no safety inference',()=>{
 const out=normalizeEonetClosed({events:[eonet()]},now),event=out.data.items[0];
 assert.equal(event.id,'eonet:closed-event');assert.equal(event.lifecycle,'closed');assert.equal(event.sourceId,'eonet-closed');assert.equal(event.observedAt,now);assert.match(event.status,/curation status, not an all-clear/);assert.equal(event.latitude,0);
 assert.equal(validEarthData('eonet-closed',out.data),true);
 assert.equal(normalizeEonetClosed({events:[eonet({closed:new Date(now-8*86400_000).toISOString()})]},now).data.items.length,0);
});
test('empty current terminal feeds are valid, historic observations age out and active datasets reject terminal records',()=>{
 assert.equal(validEarthData('nws-cancel',normalizeNwsCancellations(nws([]),now).data),true);
 assert.equal(validEarthData('eonet-closed',normalizeEonetClosed({events:[]},now).data),true);
 const event=normalizeEonetClosed({events:[eonet()]},now).data.items[0];
 assert.equal(validEarthData('eonet',{items:[{...event,sourceId:'eonet'}]}),false);
 const raw={sourceId:'eonet-closed',dataset:'changes',fetchedAt:now,observedAt:now,data:{items:[{...event,observedAt:now-8*86400_000}]}};
 assert.equal(earthEnvelope('changes',{'eonet-closed':raw},now).data.items.length,0);
});
test('terminal ingestion uses fixed bounded public endpoints without user coordinates',async()=>{
 const urls=[];
 const fetchFn=async url=>{urls.push(url);return Response.json(url.includes('weather.gov')?nws([]):{events:[]});};
 await fetchEarthSource('nws-cancel',{now,fetchFn});await fetchEarthSource('eonet-closed',{now,fetchFn});
 assert.deepEqual(urls,['https://api.weather.gov/alerts?status=actual&message_type=cancel&limit=500','https://eonet.gsfc.nasa.gov/api/v3/events?status=closed&days=7&limit=300']);
});

test('quiet NWS cancellation indexes retain valid old collection-change clocks, while stale HTTP transport is rejected', async()=>{
 const quiet={...nws([cancellation()]),updated:new Date(now-2*3600_000).toISOString()};
 assert.equal(normalizeNwsCancellations(quiet,now).data.items.length,1);
 await assert.rejects(fetchEarthSource('nws-cancel',{now,fetchFn:async()=>Response.json(quiet,{headers:{Date:new Date(now-31*60_000).toUTCString()}})}),/cache expired/);
 await assert.rejects(fetchEarthSource('nws-cancel',{now,fetchFn:async()=>Response.json(quiet,{headers:{Age:'1801'}})}),/cache expired/);
 assert.equal((await fetchEarthSource('nws-cancel',{now,fetchFn:async()=>Response.json(quiet,{headers:{Date:new Date(now).toUTCString(),Age:'0'}})})).data.items.length,1);
});
