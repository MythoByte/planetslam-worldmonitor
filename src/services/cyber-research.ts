import { safeStorageGetChecked,safeStorageSetChecked,isStorageAvailable } from '@/utils/safe-storage';
import { CYBER_RESEARCH_KEY,emptyResearchStore,parseResearchStore,retainedResearch,researchSerialized,type CyberResearchStore } from './cyber-research-model';
let error: string | null = null;
export function getCyberResearchState(): {store:CyberResearchStore;error:string|null;blocked:boolean} {
  const saved=safeStorageGetChecked(CYBER_RESEARCH_KEY);
  if (!saved.ok) return {store:emptyResearchStore(),error:'Research storage could not be read. Saved data has not been overwritten. Retry storage to continue.',blocked:true};
  const s=parseResearchStore(saved.value);
  if (!s) return {store:emptyResearchStore(),error:'Saved research data is invalid. Reset research data explicitly to start again.',blocked:true};
  return {store:retainedResearch(s),error,blocked:false};
}
export async function mutateCyberResearch(action:(s:CyberResearchStore)=>CyberResearchStore,reset=false): Promise<boolean> {
  const mutate=():boolean=>{
    const state=getCyberResearchState();
    if (state.blocked && !reset) return false;
    try {
      const serialized=researchSerialized(action(reset?emptyResearchStore():state.store));
      if (!isStorageAvailable() || !safeStorageSetChecked(CYBER_RESEARCH_KEY,serialized)) throw new Error('Research storage could not be saved. Existing saved data was retained; retry storage before continuing.');
      const checked=safeStorageGetChecked(CYBER_RESEARCH_KEY);
      if (!checked.ok || checked.value!==serialized) throw new Error('Research storage could not be verified. Reload or retry storage before continuing.');
      error=null;return true;
    } catch(e) {error=e instanceof Error?e.message:'Research data could not be saved.';return false;}
  };
  return navigator.locks?.request ? navigator.locks.request('planetslam-cyber-research',mutate) : mutate();
}
