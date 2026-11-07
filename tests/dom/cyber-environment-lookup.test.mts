import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {manualEnvironmentPackage,emptyEnvironment,identityKey,ENVIRONMENT_KEY} from '../../src/services/cyber-environment-model';
let api:typeof import('../../src/services/cyber-environment');let p:ReturnType<typeof manualEnvironmentPackage>;
const record=(id='GHSA-synthetic-0001')=>({id,summary:'Synthetic advisory',aliases:['CVE-2026-99999'],modified:'2026-11-07T00:00:00Z',affected:[{package:{ecosystem:'npm',name:'lodash'},ranges:[{type:'SEMVER',events:[{introduced:'0'},{fixed:'4.17.21'}]}]}]});
beforeEach(async()=>{
 vi.resetModules();const memory=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:vi.fn((key:string)=>memory.get(key)??null),setItem:vi.fn((key:string,value:string)=>{memory.set(key,value);}),removeItem:(key:string)=>memory.delete(key)});
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,fn:()=>unknown)=>fn()}});api=await import('../../src/services/cyber-environment');
 p=manualEnvironmentPackage({name:'lodash',version:'4.17.19',ecosystem:'npm',asset:'PRIVATE-ASSET-LABEL'});
 localStorage.setItem(ENVIRONMENT_KEY,JSON.stringify({...emptyEnvironment(),packages:[p]}));
});
afterEach(()=>{api.cancelEnvironmentLookups();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('loading local state never performs a lookup; explicit requests omit private labels/notes and follow bounded pagination',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({vulns:[record()],next_page_token:'page-two'}))).mockResolvedValueOnce(new Response(JSON.stringify({vulns:[record('GHSA-synthetic-0002')]})));vi.stubGlobal('fetch',fetch);
 expect(api.getEnvironmentState().store.packages).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();await api.runEnvironmentLookups([p]);expect(fetch).toHaveBeenCalledTimes(2);
 const options=fetch.mock.calls[0]![1];expect(JSON.parse(options.body)).toEqual({package:{name:'lodash',ecosystem:'npm'},version:'4.17.19'});expect(options.credentials).toBe('omit');expect(options.referrerPolicy).toBe('no-referrer');expect(options.body).not.toContain('PRIVATE-ASSET-LABEL');expect(JSON.parse(fetch.mock.calls[1]![1].body).page_token).toBe('page-two');
 const result=api.getEnvironmentState().store.lookups[0]!;expect(result.key).toBe(identityKey(p));expect(result.status).toBe('complete');expect(result.advisories).toHaveLength(2);expect(result.advisories[0]!.fixes).toEqual(['4.17.21']);
});
it('network failures are unknown, never a zero-vulnerability success',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('Synthetic outage')));await api.runEnvironmentLookups([p]);const l=api.getEnvironmentState().store.lookups[0]!;expect(l.status).toBe('failed');expect(l.message).toContain('outage');
});
it('failed refreshes retain previous evidence with its original observation timestamp',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({vulns:[record()]}))).mockRejectedValueOnce(Error('Synthetic outage'));vi.stubGlobal('fetch',fetch);await api.runEnvironmentLookups([p]);const observed=api.getEnvironmentState().store.lookups[0]!.advisories[0]!.observedAt;await api.runEnvironmentLookups([p]);const l=api.getEnvironmentState().store.lookups[0]!;expect(l.status).toBe('partial');expect(l.advisories).toHaveLength(1);expect(l.advisories[0]!.observedAt).toBe(observed);
});
it('withdrawn entries are omitted, mismatched-package evidence and repeated pagination tokens cannot claim completeness',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({vulns:[{...record(),withdrawn:'2026-11-07T00:00:00Z'}]}))));let result=await api.queryEnvironmentPackage(p,new AbortController().signal);expect(result.status).toBe('complete');expect(result.advisories).toHaveLength(0);
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify({vulns:[record()],next_page_token:'repeat'}))));result=await api.queryEnvironmentPackage(p,new AbortController().signal);expect(result.status).toBe('partial');expect(result.message).toContain('pagination');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({vulns:[{...record(),affected:[{package:{name:'different-package',ecosystem:'npm'}}]}]}))));result=await api.queryEnvironmentPackage(p,new AbortController().signal);expect(result.status).toBe('failed');expect(result.message).toContain('requested package');
});
it('cancellation invalidates a late response and cannot resurrect cleared inventory or findings',async()=>{
 let finish!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{finish=resolve;})));const pending=api.runEnvironmentLookups([p]);expect(api.getEnvironmentState().progress.running).toBe(true);await api.mutateEnvironment(s=>({...s,packages:[],lookups:[]}),{inventoryChange:true});finish(new Response(JSON.stringify({vulns:[record()]})));await pending;expect(api.getEnvironmentState().store.packages).toHaveLength(0);expect(api.getEnvironmentState().store.lookups).toHaveLength(0);expect(api.getEnvironmentState().progress.running).toBe(false);
});
it('failed reads cannot overwrite a profile; failed or silently dropped writes cannot report success',async()=>{
 const raw=localStorage.getItem(ENVIRONMENT_KEY);vi.mocked(localStorage.getItem).mockImplementation(()=>{throw Error('Read denied');});expect(await api.mutateEnvironment(()=>emptyEnvironment())).toBe(false);
 vi.mocked(localStorage.getItem).mockImplementation(()=>raw);vi.mocked(localStorage.setItem).mockImplementation(()=>{});expect(await api.mutateEnvironment(()=>emptyEnvironment())).toBe(false);expect(api.getEnvironmentState().error).toContain('verified');expect(localStorage.getItem(ENVIRONMENT_KEY)).toBe(raw);
});
it('oversized or malformed responses remain failed and do not persist unbounded data',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-length':'9999999'}})));let r=await api.queryEnvironmentPackage(p,new AbortController().signal);expect(r.status).toBe('failed');expect(r.message).toContain('limit');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{')));r=await api.queryEnvironmentPackage(p,new AbortController().signal);expect(r.status).toBe('failed');
});
