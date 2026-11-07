import {safeStorageGetChecked,safeStorageSetChecked,isStorageAvailable} from '@/utils/safe-storage';
import {ENVIRONMENT_KEY,LOOKUP_LIMIT,emptyEnvironment,parseEnvironment,identityKey,canLookupPackage,type EnvironmentStore,type EnvironmentPackage,type EnvironmentLookup,type EnvironmentAdvisory} from './cyber-environment-model';
// Only this explicit, user-initiated adapter sends package identities off-device.
const OSV_QUERY = 'https://api.osv.dev/v1/query';
const OSV_RECORD = 'https://osv.dev/vulnerability/';
let error: string | null = null;
let active: AbortController | null = null;
let revision = 0;
let progress = {running:false,done:0,total:0};
const listeners = new Set<()=>void>();
const emit=()=>{for(const fn of listeners)fn();};
export function subscribeEnvironment(fn:()=>void):()=>void {listeners.add(fn);return()=>{listeners.delete(fn);};}
export function getEnvironmentState() {
  const raw=safeStorageGetChecked(ENVIRONMENT_KEY);
  if(!raw.ok)return {store:emptyEnvironment(),blocked:true,error:'Environment storage could not be read. Existing data has not been overwritten.',progress:{...progress}};
  const store=parseEnvironment(raw.value);
  if(!store)return {store:emptyEnvironment(),blocked:true,error:'Saved environment data is invalid. Reset explicitly to start over.',progress:{...progress}};
  return {store,blocked:false,error,progress:{...progress}};
}
export function cancelEnvironmentLookups():void {revision++;active?.abort();active=null;progress={...progress,running:false};emit();}
export async function mutateEnvironment(action:(s:EnvironmentStore)=>EnvironmentStore,options:{reset?:boolean;inventoryChange?:boolean}={}):Promise<boolean> {
  if(options.inventoryChange||options.reset)cancelEnvironmentLookups();
  const commit=()=>{
    const state=getEnvironmentState();if(state.blocked&&!options.reset)return false;
    try{
      const next=action(options.reset?emptyEnvironment():state.store),raw=JSON.stringify(next);
      if(!parseEnvironment(raw))throw new Error('Environment exceeds its validated storage limits. Existing saved data was retained.');
      if(!isStorageAvailable()||!safeStorageSetChecked(ENVIRONMENT_KEY,raw))throw new Error('Environment storage could not be saved. Your existing data and unsaved draft are retained.');
      const check=safeStorageGetChecked(ENVIRONMENT_KEY);
      if(!check.ok||check.value!==raw)throw new Error('Environment storage could not be verified. Retry storage before continuing.');
      error=null;return true;
    }catch(e){error=e instanceof Error?e.message:'Environment could not be saved.';return false;}
  };
  const ok=navigator.locks?.request?await navigator.locks.request('planetslam-cyber-environment',commit):commit();emit();return ok;
}
function advisoryFromOsv(raw:unknown,p:EnvironmentPackage):EnvironmentAdvisory|null {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('OSV returned an invalid advisory.');
  const v=raw as Record<string,unknown>;
  if(v.withdrawn!==undefined&&v.withdrawn!==null){if(typeof v.withdrawn==='string'&&Number.isFinite(Date.parse(v.withdrawn)))return null;throw new Error('Invalid OSV withdrawal timestamp.');}
  if(typeof v.id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v.id))throw new Error('OSV returned an invalid advisory ID.');
  if(!Array.isArray(v.affected))throw new Error('OSV advisory is missing package evidence.');
  // Never attach another package's fix hints to this exact version-query result.
  const same=v.affected.filter(a=>{
    if(!a||typeof a!=='object')return false;
    const x=a as {package?:{name?:string;ecosystem?:string}};
    return x.package?.ecosystem===p.ecosystem && typeof x.package.name==='string' && canonical(x.package.name,p.ecosystem)===canonical(p.name,p.ecosystem);
  }) as {ranges?:{type?:string;events?:{fixed?:unknown}[]}[]}[];
  if(!same.length)throw new Error('OSV result does not contain evidence for the requested package.');
  const fixes=[...new Set(same.flatMap(a=>Array.isArray(a.ranges)?a.ranges.flatMap(r=>['SEMVER','ECOSYSTEM'].includes(r.type||'')&&Array.isArray(r.events)?r.events.flatMap(e=>typeof e.fixed==='string'&&e.fixed.length<=120?[e.fixed]:[]):[]):[]))].slice(0,20);
  return {id:v.id,summary:typeof v.summary==='string'?v.summary.slice(0,800):'OSV advisory; read the linked record.',aliases:Array.isArray(v.aliases)?v.aliases.filter((a):a is string=>typeof a==='string'&&/^[\w.-]{1,100}$/.test(a)).slice(0,30):[],modified:typeof v.modified==='string'?v.modified.slice(0,40):'',published:typeof v.published==='string'?v.published.slice(0,40):'',url:OSV_RECORD+encodeURIComponent(v.id),fixes,observedAt:Date.now()};
}
function canonical(name:string,ecosystem:string):string {
  if(ecosystem==='PyPI')return name.toLowerCase().replace(/[-_.]+/g,'-');
  if(ecosystem==='NuGet')return name.toLowerCase();
  if(ecosystem==='crates.io')return name.toLowerCase().replace(/_/g,'-');
  return name;
}
async function boundedJson(response:Response,signal:AbortSignal):Promise<unknown>{
  if(!response.ok)throw new Error(`OSV returned HTTP ${response.status}.`);
  const declared=Number(response.headers.get('content-length'));
  if(declared>2*1024*1024)throw new Error('OSV response exceeds the 2 MiB page limit.');
  if(!response.body)throw new Error('OSV returned no readable response body.');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){if(signal.aborted)throw new Error('Lookup cancelled.');const x=await reader.read();if(x.done)break;bytes+=x.value.byteLength;if(bytes>2*1024*1024)throw new Error('OSV response exceeds the 2 MiB page limit.');chunks.push(x.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const joined=new Uint8Array(bytes);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(joined));
}
export async function queryEnvironmentPackage(p:EnvironmentPackage,signal:AbortSignal):Promise<EnvironmentLookup>{
  if(!canLookupPackage(p))throw new Error('Package identity/version is not eligible for OSV lookup.');
  const advisories=new Map<string,EnvironmentAdvisory>();const tokens=new Set<string>();let token='';
  const result:EnvironmentLookup={key:identityKey(p),name:p.name,ecosystem:p.ecosystem,version:p.version,at:Date.now(),status:'failed',advisories:[],message:''};
  try{
    for(let page=0;page<5;page++){
      const request={package:{name:p.name,ecosystem:p.ecosystem},version:p.version,...(token?{page_token:token}:{})};
      const timeout=AbortSignal.timeout(20000);const combined=AbortSignal.any([signal,timeout]);
      const response=await fetch(OSV_QUERY,{method:'POST',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(request),signal:combined});
      const raw=await boundedJson(response,combined);
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('OSV returned an invalid response.');
      const data=raw as {vulns?:unknown;next_page_token?:unknown};
      if(data.vulns!==undefined&&!Array.isArray(data.vulns))throw new Error('OSV returned an invalid vulnerability list.');
      const rows=(data.vulns||[]) as unknown[];if(rows.length>200)throw new Error('OSV response exceeds its record budget.');
      for(const row of rows){const a=advisoryFromOsv(row,p);if(a)advisories.set(a.id,a);if(advisories.size>50)throw new Error('OSV lookup exceeds the 50-advisory budget.');}
      if(data.next_page_token!==undefined&&typeof data.next_page_token!=='string')throw new Error('Invalid OSV continuation token.');
      token=typeof data.next_page_token==='string'?data.next_page_token:'';
      if(!token){result.status='complete';break;}
      if(token.length>2000||tokens.has(token))throw new Error('OSV pagination could not be completed.');tokens.add(token);
      if(page===4)throw new Error('OSV pagination exceeded five pages.');
    }
  }catch(e){result.status=advisories.size?'partial':'failed';result.message=e instanceof Error?e.message.slice(0,300):'OSV could not be reached.';}
  result.advisories=[...advisories.values()].slice(0,50);
  return result;
}
export async function runEnvironmentLookups(plan:EnvironmentPackage[]):Promise<void>{
  if(progress.running||getEnvironmentState().blocked)return;
  // The caller must show and confirm this bounded plan before invoking this function.
  const current=getEnvironmentState().store;
  const requested=plan.filter(p=>canLookupPackage(p)&&current.packages.some(c=>c.id===p.id&&identityKey(c)===identityKey(p))).slice(0,25);
  if(!requested.length)return;
  const ticket=++revision,controller=new AbortController();active=controller;progress={running:true,done:0,total:requested.length};emit();
  try{
    for(const p of requested){
      if(ticket!==revision||controller.signal.aborted)break;
      const lookup=await queryEnvironmentPackage(p,controller.signal);
      if(ticket!==revision||controller.signal.aborted)break;
      const saved=await mutateEnvironment(s=>{
        if(ticket!==revision||!s.packages.some(c=>c.id===p.id&&identityKey(c)===lookup.key))return s;
        const previous=s.lookups.find(l=>l.key===lookup.key);
        // A failed refresh cannot erase previously observed advisories or masquerade as a clean result.
        const retained=new Map(lookup.advisories.map(a=>[a.id,a]));for(const a of previous?.advisories||[])if(!retained.has(a.id))retained.set(a.id,a);
        const value=lookup.status!=='complete'&&previous?{...lookup,advisories:[...retained.values()].slice(0,50),status:'partial' as const,message:('Incomplete refresh; earlier evidence retained with its original observation dates. '+lookup.message).slice(0,300)}:lookup;
        const lookups=[value,...s.lookups.filter(l=>l.key!==lookup.key)].slice(0,LOOKUP_LIMIT);
        if(lookups.reduce((n,l)=>n+l.advisories.length,0)>500)throw new Error('The 500-advisory profile budget is reached. Remove old lookup results before continuing.');
        return {...s,lookups};
      });
      if(!saved)break;progress={...progress,done:progress.done+1};emit();
    }
  }finally{if(ticket===revision){active=null;progress={...progress,running:false};emit();}}
}
