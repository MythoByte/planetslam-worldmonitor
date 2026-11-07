// @vitest-environment happy-dom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getCyberResearchState,mutateCyberResearch} from '../../src/services/cyber-research';
import {CYBER_RESEARCH_KEY,emptyResearchStore} from '../../src/services/cyber-research-model';
beforeEach(()=>{const memory=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:vi.fn((key:string)=>memory.get(key)??null),setItem:vi.fn((key:string,value:string)=>{memory.set(key,value);}),removeItem:vi.fn((key:string)=>{memory.delete(key);})});vi.stubGlobal('navigator',{locks:{request:async(_key:string,fn:()=>unknown)=>fn()}});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('failed reads preserve the existing profile and never invoke a mutation',async()=>{
 localStorage.setItem(CYBER_RESEARCH_KEY,JSON.stringify(emptyResearchStore()));vi.spyOn(localStorage,'getItem').mockImplementation(()=>{throw new Error('Denied');});const action=vi.fn(s=>s);
 expect(getCyberResearchState().blocked).toBe(true);expect(await mutateCyberResearch(action)).toBe(false);expect(action).not.toHaveBeenCalled();
});
it('failed writes leave saved research untouched and expose a recoverable error',async()=>{
 const raw=JSON.stringify(emptyResearchStore());localStorage.setItem(CYBER_RESEARCH_KEY,raw);vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('Quota');});
 expect(await mutateCyberResearch(s=>({...s,captureEnabled:false}))).toBe(false);expect(localStorage.getItem(CYBER_RESEARCH_KEY)).toBe(raw);expect(getCyberResearchState().error).toMatch(/could not be saved/);
});
it('silent storage drops cannot report success',async()=>{
 localStorage.setItem(CYBER_RESEARCH_KEY,JSON.stringify(emptyResearchStore()));vi.spyOn(localStorage,'setItem').mockImplementation(()=>{});
 expect(await mutateCyberResearch(s=>({...s,captureEnabled:false}))).toBe(false);expect(getCyberResearchState().error).toMatch(/verified/);
});
it('malformed profiles require explicit reset, then mutations recover',async()=>{
 localStorage.setItem(CYBER_RESEARCH_KEY,'{');expect(await mutateCyberResearch(s=>s)).toBe(false);expect(localStorage.getItem(CYBER_RESEARCH_KEY)).toBe('{');
 expect(await mutateCyberResearch(s=>s,true)).toBe(true);expect(getCyberResearchState().blocked).toBe(false);expect(getCyberResearchState().error).toBe(null);
});
