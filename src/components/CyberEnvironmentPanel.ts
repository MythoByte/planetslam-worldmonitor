import {Panel} from './Panel';
import {safeHtml,safeUrlAttr,joinSafeHtml,type SafeHtml} from '@/utils/sanitize';
import {fetchCyberDataset} from '@/services/cyber-dashboard';
import {getEnvironmentState,mutateEnvironment,subscribeEnvironment,runEnvironmentLookups,cancelEnvironmentLookups} from '@/services/cyber-environment';
import {ENVIRONMENT_KEY,ECOSYSTEMS,identityKey,canLookupPackage,manualEnvironmentPackage,previewEnvironmentImport,mergeEnvironmentImport,lookupPlan,pinEnvironmentTask,environmentExport,remediationCsv,type EnvironmentPackage,type EnvironmentTask,type InventoryPreview} from '@/services/cyber-environment-model';
import type {CyberEnvelope,CyberKevData} from '@/types/cyber-dashboard';
import '@/styles/cyber.css';
const date=(n:number)=>new Date(n).toISOString().slice(0,16).replace('T',' ')+' UTC';
const blankManual=()=>({asset:'My environment',name:'',version:'',ecosystem:'Unknown'});
export class CyberEnvironmentPanel extends Panel {
  private stopped=false;
  private fileRevision=0;
  private unsubscribe:()=>void;
  private view:'inventory'|'findings'|'tasks'='inventory';
  private manual=blankManual();
  private editing='';
  private query='';
  private visible=20;
  private preview:InventoryPreview|null=null;
  private replaceAsset=true;
  private plan:EnvironmentPackage[]=[];
  private selected='';
  private taskSelected='';
  private taskDraft:{id:string;notes:string;owner:string;due:string;status:string;baseline:EnvironmentTask;dirty:boolean}|null=null;
  private message='';
  private kev:CyberEnvelope<CyberKevData>|null=null;
  private readonly onStorage=(e:StorageEvent)=>{if(e.key===ENVIRONMENT_KEY||e.key===null){this.plan=[];cancelEnvironmentLookups();this.render();}};
  constructor(){
    super({id:'cyber-environment',title:'My Environment',className:'cyber-panel',defaultRowSpan:3,
      infoTooltip:'User-declared inventory and private remediation notes in this browser. No scanning or automatic OSV requests. Review each outbound lookup plan explicitly.'});
    this.unsubscribe=subscribeEnvironment(()=>this.render());window.addEventListener('storage',this.onStorage);
    this.content.addEventListener('input',e=>{
      const el=e.target as HTMLInputElement,key=el.dataset.envManual as keyof ReturnType<typeof blankManual>;
      if(key)this.manual[key]=el.value;
      if(el.dataset.envSearch!==undefined)this.query=el.value.slice(0,160);
      if(this.taskDraft&&el.dataset.envTaskField){const key=el.dataset.envTaskField as 'notes'|'owner'|'due'|'status';this.taskDraft[key]=el.value;this.taskDraft.dirty=true;}
    },{signal:this.signal});
    this.content.addEventListener('change',e=>{
      const el=e.target as HTMLInputElement;
      if(el.dataset.envManual)this.manual[el.dataset.envManual as keyof ReturnType<typeof blankManual>]=el.value;
      if(el.dataset.envTaskField&&this.taskDraft){const key=el.dataset.envTaskField as 'notes'|'owner'|'due'|'status';this.taskDraft[key]=el.value;this.taskDraft.dirty=true;}
      if(el.dataset.envImportMode!==undefined)this.replaceAsset=el.value==='replace';
      if(el.dataset.envSelect!==undefined){this.selected=el.value;this.render();}
      if(el.dataset.envTaskSelect!==undefined){this.taskSelected=el.value;this.taskDraft=null;this.render();}
      if(el.dataset.envFile!==undefined&&el.files?.[0])void this.readFile(el.files[0]);
    },{signal:this.signal});
    this.content.addEventListener('click',e=>{const el=(e.target as HTMLElement).closest<HTMLElement>('[data-env-action]');if(el)void this.action(el.dataset.envAction!,el.dataset.id||'');},{signal:this.signal});
    this.runWhenConnected(()=>{this.render();void this.refreshKev();});
  }
  override hide():void{this.fileRevision++;this.plan=[];cancelEnvironmentLookups();super.hide();}
  override show():void{super.show();this.runWhenConnected(()=>this.render());}
  private async refreshKev():Promise<void>{try{const e=await fetchCyberDataset<CyberKevData>('kev');if(!this.stopped){this.kev=e;this.render();}}catch{if(!this.stopped){this.kev=null;this.render();}}}
  private async readFile(file:File):Promise<void>{
    const ticket=++this.fileRevision;this.message='';
    try{if(file.size>5*1024*1024)throw new Error('Choose JSON at most 5 MiB.');const raw=await file.text();if(this.stopped||ticket!==this.fileRevision)return;this.preview=previewEnvironmentImport(raw,this.manual.asset);this.plan=[];}
    catch(e){if(this.stopped||ticket!==this.fileRevision)return;this.message=e instanceof Error?e.message:'Inventory could not be read.';this.preview=null;}
    this.render();
  }
  private download(name:string,body:string,type:string):void{const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  private async action(action:string,id:string):Promise<void>{
    this.message='';const state=getEnvironmentState();
    if(['inventory','findings','tasks'].includes(action)){this.view=action as typeof this.view;this.render();return;}
    if(action==='filter'){this.visible=20;this.render();return;}
    if(action==='more'){this.visible+=20;this.render();return;}
    if(action==='cancel-query'){cancelEnvironmentLookups();this.plan=[];return;}
    if(action==='plan'){this.plan=lookupPlan(state.store,state.store.packages.filter(p=>this.matches(p)).map(p=>p.id));this.render();return;}
    if(action==='plan-selected'){this.plan=lookupPlan(state.store,[id]);this.render();return;}
    if(action==='send-plan'){const plan=this.plan;this.plan=[];this.view='findings';await runEnvironmentLookups(plan);this.render();return;}
    if(action==='cancel-plan'){this.plan=[];this.render();return;}
    if(action==='retry'){await mutateEnvironment(s=>s);return;}
    if(action==='reset'){if(await mutateEnvironment(s=>s,{reset:true})){this.preview=null;this.plan=[];this.taskDraft=null;this.editing='';this.manual=blankManual();}this.render();return;}
    if(state.blocked)return;
    if(action==='import'&&this.preview){const preview=this.preview;if(await mutateEnvironment(s=>mergeEnvironmentImport(s,preview,this.replaceAsset),{inventoryChange:true})){this.preview=null;this.plan=[];this.message='Inventory saved locally. No OSV requests were sent.';}}
    if(action==='cancel-import')this.preview=null;
    if(action==='manual-save'){
      try{const p=manualEnvironmentPackage(this.manual,this.editing||undefined);const ok=await mutateEnvironment(s=>{
        if(!this.editing&&s.packages.length>=500)throw new Error('The 500-package limit is reached.');
        if(this.editing&&!s.packages.some(c=>c.id===this.editing))throw new Error('This item was removed in another tab; reload the inventory.');
        if(s.packages.some(c=>c.id!==p.id&&c.asset===p.asset&&identityKey(c)===identityKey(p)))throw new Error('This asset already has that package/version.');
        return {...s,packages:this.editing?s.packages.map(c=>c.id===p.id?p:c):[...s.packages,p]};
      },{inventoryChange:true});if(ok){this.editing='';this.manual=blankManual();this.plan=[];this.message='Declared package saved. No lookup was performed.';}}
      catch(e){this.message=e instanceof Error?e.message:'Package could not be saved.';}
    }
    if(action==='edit'){const p=state.store.packages.find(p=>p.id===id);if(p){this.manual={asset:p.asset,name:p.name,version:p.version,ecosystem:p.ecosystem};this.editing=id;}}
    if(action==='manual-cancel'){this.manual=blankManual();this.editing='';}
    if(action==='remove'){await mutateEnvironment(s=>({...s,packages:s.packages.filter(p=>p.id!==id)}),{inventoryChange:true});this.plan=[];}
    if(action==='clear'){await mutateEnvironment(s=>({...s,packages:[],lookups:[]}),{inventoryChange:true});this.plan=[];}
    if(action==='clear-lookups'){await mutateEnvironment(s=>({...s,lookups:[]}),{inventoryChange:true});this.plan=[];}
    if(action==='kev')await this.refreshKev();
    if(action==='json'){this.download('planetslam-my-environment.json',environmentExport(state.store),'application/json');return;}
    if(action==='csv'){this.download('planetslam-remediation.csv',remediationCsv(state.store),'text/csv;charset=utf-8');return;}
    if(action==='pin'){
      const p=state.store.packages.find(p=>p.id===this.selected),l=p?state.store.lookups.find(l=>l.key===identityKey(p)):undefined,a=l?.advisories.find(a=>a.id===id);
      if(p&&a&&await mutateEnvironment(s=>pinEnvironmentTask(s,p,a))){this.view='tasks';this.taskSelected='';this.taskDraft=null;}
    }
    if(action==='task-reload'){this.taskDraft=null;this.render();this.restoreTaskFields();return;}
    if(action==='task-save'&&this.taskDraft){
      const draft=structuredClone(this.taskDraft);
      if(await mutateEnvironment(s=>{
        const current=s.tasks.find(t=>t.id===draft.id);if(!current)throw new Error('Task was removed in another tab; unsaved draft retained.');
        if(JSON.stringify(current)!==JSON.stringify(draft.baseline))throw new Error('Task changed in another tab. Your draft is retained; reload saved values before editing that version.');
        return {...s,tasks:s.tasks.map(t=>t.id===draft.id?{...t,status:draft.status as EnvironmentTask['status'],owner:draft.owner.trim(),due:draft.due,notes:draft.notes,updatedAt:Date.now()}:t)};
      })){this.taskDraft=null;this.message='Remediation changes saved on this device.';}
    }
    if(action==='task-delete'){if(await mutateEnvironment(s=>({...s,tasks:s.tasks.filter(t=>t.id!==id)}))){this.taskDraft=null;this.taskSelected='';}}
    this.render();
  }
  private matches(p:EnvironmentPackage):boolean{return !this.query.trim()||`${p.asset} ${p.name} ${p.version} ${p.ecosystem}`.toLowerCase().includes(this.query.trim().toLowerCase());}
  private restoreTaskFields():void{if(!this.taskDraft)return;for(const el of this.content.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('[data-env-task-field]'))el.value=this.taskDraft[el.dataset.envTaskField as 'notes'|'owner'|'due'|'status'];}
  private kevBadges(aliases:string[]):SafeHtml{
    const fresh=this.kev?.status==='fresh'&&this.kev.expiresAt!==null&&this.kev.expiresAt>Date.now();
    if(!fresh)return safeHtml`<p class="cyber-note">CISA KEV context unavailable or delayed; exploitation status remains unknown.</p>`;
    const matches=this.kev?.data?.items.filter(i=>aliases.includes(i.id))||[];
    return matches.length?joinSafeHtml(matches.map(i=>safeHtml`<p class="cyber-action"><strong>CISA known exploitation evidence · ${i.id}</strong><br>${i.action}<br><a class="cyber-reference" href="${safeUrlAttr(i.url)}" target="_blank" rel="noopener noreferrer">CISA evidence ↗</a> · Does not establish compromise of this asset.</p>`)):safeHtml`<p class="cyber-note">No linked ID found in the current KEV catalog. This is not evidence of absent exploitation.</p>`;
  }
  private taskForm(t:EnvironmentTask,current:EnvironmentPackage|undefined):SafeHtml{
    const d=this.taskDraft?.id===t.id&&this.taskDraft.dirty?this.taskDraft:{id:t.id,notes:t.notes,owner:t.owner,due:t.due,status:t.status,baseline:structuredClone(t),dirty:false};this.taskDraft=d;
    return safeHtml`<section data-env-task="${t.id}"><h3>${t.packageSnapshot.asset} · ${t.packageSnapshot.name} ${t.packageSnapshot.version}</h3><a class="cyber-reference" href="${safeUrlAttr(t.advisory.url)}" target="_blank" rel="noopener noreferrer">${t.advisory.id} ↗</a><p>${t.advisory.summary}</p><p class="cyber-note">Evidence observed ${date(t.lookupAt)}. ${current&&current.asset===t.packageSnapshot.asset&&identityKey(current)===identityKey(t.packageSnapshot)?'Current inventory still declares this package/version.':'Inventory changed or item was removed. This task retains older evidence; recheck current applicability.'} Workflow states do not verify installed fixes or safety.</p><div class="cyber-explore-filters"><label>Status<select aria-label="Remediation status" data-env-task-field="status">${joinSafeHtml(['open','in-progress','resolved','accepted'].map(v=>safeHtml`<option value="${v}" ${d.status===v?safeHtml`selected`:''}>${v}</option>`))}</select></label><label>Owner<input aria-label="Remediation owner" data-env-task-field="owner" maxlength="100" value="${d.owner}"></label><label>Due date<input type="date" aria-label="Remediation due date" data-env-task-field="due" value="${d.due}"></label></div><label class="cyber-research-label">Private remediation notes<textarea aria-label="Private remediation notes" data-env-task-field="notes" maxlength="4000" rows="5">${d.notes}</textarea></label><div class="cyber-toolbar"><button data-env-action="task-save">Save remediation</button><button data-env-action="task-reload">Reload saved remediation</button><button data-env-action="task-delete" data-id="${t.id}">Delete remediation task</button></div></section>`;
  }
  private render():void{
    if(this.stopped)return;
    const state=getEnvironmentState(),s=state.store,filtered=s.packages.filter(p=>this.matches(p));
    const open=new Map([...this.content.querySelectorAll<HTMLDetailsElement>('details')].map(d=>[d.dataset.envDetails,d.open]));
    const active=document.activeElement as HTMLInputElement|null,focus=active?.dataset.envManual||active?.dataset.envTaskField||(active?.dataset.envSearch!==undefined?'search':''),caret=active&&'selectionStart'in active?[active.selectionStart,active.selectionEnd]:null;
    const selected=s.packages.find(p=>p.id===this.selected)||filtered[0]||s.packages[0];if(selected)this.selected=selected.id;
    const lookup=selected?s.lookups.find(l=>l.key===identityKey(selected)):undefined;
    const task=s.tasks.find(t=>t.id===this.taskSelected)||(this.taskDraft?.dirty?this.taskDraft.baseline:s.tasks[0]);if(task)this.taskSelected=task.id;
    const eco=(value:string)=>joinSafeHtml(ECOSYSTEMS.map(v=>safeHtml`<option value="${v}" ${value===v?safeHtml`selected`:''}>${v}</option>`));
    const packageOption=(p:EnvironmentPackage)=>safeHtml`<option value="${p.id}" ${selected?.id===p.id?safeHtml`selected`:''}>${p.asset} · ${p.name} ${p.version||'(version unknown)'}</option>`;
    this.setSafeContentImmediate(safeHtml`<div class="cyber-body"><p class="cyber-note">User-declared inventory and private remediation notes stay in this browser. No scanning and no automatic OSV lookups. Inventory is not encrypted or account-synchronized.</p><div class="cyber-provenance"><strong>${s.packages.length} / 500 declared packages</strong><span>${s.packages.filter(p=>!canLookupPackage(p)).length} need identity/version review</span><span>${s.tasks.length} / 200 remediation tasks</span></div>${state.error||this.message?safeHtml`<p role="status" class="cyber-note">${state.error||this.message}</p>`:''}${!state.blocked&&state.error?safeHtml`<button data-env-action="retry">Retry environment storage</button>`:''}<nav class="cyber-toolbar" aria-label="Environment views">${joinSafeHtml([['inventory','Inventory'],['findings','Version findings'],['tasks','Remediation']].map(([key,label])=>safeHtml`<button data-env-action="${key}" aria-pressed="${this.view===key}">${label}</button>`))}</nav>${state.progress.running?safeHtml`<p role="status">OSV lookup ${state.progress.done} / ${state.progress.total}. Only explicitly confirmed package identities/versions are being sent.</p><button data-env-action="cancel-query">Cancel remaining OSV lookups</button>`:''}${state.blocked?safeHtml`<button data-env-action="retry">Retry environment storage</button><button data-env-action="reset">Reset all environment data and notes</button>`:safeHtml`<details class="cyber-methodology" data-env-details="privacy"><summary>Privacy, coverage and storage</summary><p class="cyber-note">Imports, asset labels and notes are local. Confirmed lookups send only registry ecosystem, package name and exact version directly to OSV; OSV sees your IP. OSV applies registry version semantics, including normalization. Results do not prove local exploitability or compromise. Missing identity/version, unsupported ecosystems, distro backports, vendor-specific products and unreachable/partial lookups remain unknown. No result is an all-clear. Up to 100 lookup snapshots / 500 advisory entries are retained; pinned tasks keep their own evidence. Cooperating tabs use Web Locks where available; otherwise storage coordination is best effort.</p><div class="cyber-toolbar"><button data-env-action="json">Export private environment JSON</button><button data-env-action="csv">Export private remediation CSV</button><button data-env-action="clear-lookups">Clear lookup snapshots</button><button data-env-action="clear">Clear inventory and lookups; keep tasks</button><button data-env-action="reset">Reset all environment data and notes</button></div></details>`}${this.preview?safeHtml`<section class="cyber-action" data-env-preview><h3>Review local import · ${this.preview.format}</h3><p>${this.preview.packages.length} unique packages · ${this.preview.duplicates} duplicates omitted · ${this.preview.missingVersions} missing versions · ${this.preview.unidentified} unresolved identities.</p><label>Import mode<select aria-label="Inventory import mode" data-env-import-mode><option value="replace" ${this.replaceAsset?safeHtml`selected`:''}>Replace this asset's inventory</option><option value="merge" ${!this.replaceAsset?safeHtml`selected`:''}>Add entries to existing inventory</option></select></label><p class="cyber-note">Asset: ${this.preview.packages[0]?.asset}. Replacement removes ${s.packages.filter(p=>p.asset===this.preview!.packages[0]?.asset).length} current rows for this asset, retaining remediation snapshots. Raw SBOM metadata is discarded. No outbound lookup is performed.</p>${joinSafeHtml(this.preview.packages.slice(0,8).map(p=>safeHtml`<p>${p.ecosystem} · ${p.name} · ${p.version||'version unknown'} ${p.identityNote}</p>`))}<button data-env-action="import" ${state.blocked?safeHtml`disabled`:''}>Confirm local inventory import</button><button data-env-action="cancel-import">Cancel import</button></section>`:''}${this.plan.length?safeHtml`<section class="cyber-action" data-env-plan><h3>Review outbound OSV lookup plan</h3><p>Send ${this.plan.length} distinct package versions directly to <a class="cyber-reference" href="https://osv.dev/" target="_blank" rel="noopener noreferrer">OSV ↗</a>. Asset labels, full SBOM and notes are excluded. This can disclose which software/version you use. Nothing is sent until you confirm.</p><p class="cyber-note">At most 25 package versions per run. Each query may request up to five bounded result pages. Cancel stops pending work. This plan is not expanded after inventory edits.</p><pre class="cyber-environment-plan">${JSON.stringify(this.plan.map(p=>({package:{name:p.name,ecosystem:p.ecosystem},version:p.version})),null,2)}</pre><button data-env-action="send-plan" ${state.blocked||state.progress.running?safeHtml`disabled`:''}>Send ${this.plan.length} package versions to OSV</button><button data-env-action="cancel-plan">Cancel lookup plan</button></section>`:''}${this.view==='inventory'?safeHtml`<details class="cyber-methodology" data-env-details="import" open><summary>Add manual inventory or import SBOM</summary><div class="cyber-explore-filters"><label>Asset / environment label<input aria-label="Asset label" data-env-manual="asset" maxlength="100" value="${this.manual.asset}"></label><label>Registry package name / product<input aria-label="Declared package name" data-env-manual="name" maxlength="240" value="${this.manual.name}"></label><label>Installed version<input aria-label="Declared installed version" data-env-manual="version" maxlength="120" value="${this.manual.version}"></label><label>Ecosystem<select aria-label="Package ecosystem" data-env-manual="ecosystem">${eco(this.manual.ecosystem)}</select></label><button data-env-action="manual-save" ${state.blocked?safeHtml`disabled`:''}>${this.editing?'Save inventory edit':'Add declared package'}</button>${this.editing?safeHtml`<button data-env-action="manual-cancel">Cancel inventory edit</button>`:''}</div><label>Inventory JSON<input type="file" aria-label="Inventory JSON file" data-env-file accept=".json,application/json" ${state.blocked?safeHtml`disabled`:''}></label><p class="cyber-note">JSON only, at most 5 MiB and 500 unique packages. CycloneDX 1.4–1.7, SPDX 2.2/2.3 or PlanetSlam inventory v1. A preview appears before saving. Unknown vendor products can be recorded manually; this does not create a version match.</p></details><div class="cyber-toolbar"><label>Filter inventory<input type="search" aria-label="Filter environment inventory" data-env-search maxlength="160" value="${this.query}"></label><button data-env-action="filter">Apply inventory filter</button><button data-env-action="plan" ${state.blocked||state.progress.running?safeHtml`disabled`:''}>Review lookups for filtered inventory</button></div><p class="cyber-note">${filtered.length} matching inventory rows. Lookups cover supported public registry packages only.</p>${joinSafeHtml(filtered.slice(0,this.visible).map(p=>{const l=s.lookups.find(l=>l.key===identityKey(p));return safeHtml`<article class="cyber-card" data-env-package="${p.id}"><strong>${p.asset} · ${p.name} ${p.version||'(version unknown)'}</strong><p>${p.ecosystem} · ${p.identityNote||(!canLookupPackage(p)?'Version applicability unknown; declare an exact supported package identity.':l?`${l.status} OSV query · ${l.advisories.length} returned/retained advisories · ${date(l.at)}`:'Not queried')}</p><div class="cyber-toolbar"><button data-env-action="edit" data-id="${p.id}">Edit declaration</button><button data-env-action="remove" data-id="${p.id}">Remove inventory item</button><button data-env-action="plan-selected" data-id="${p.id}" ${!canLookupPackage(p)||state.progress.running?safeHtml`disabled`:''}>Review this package lookup</button></div></article>`; }))}${filtered.length>this.visible?safeHtml`<button data-env-action="more">Show more inventory</button>`:''}`:this.view==='findings'?safeHtml`<label>Choose declared package<select aria-label="Choose environment package" data-env-select>${joinSafeHtml(s.packages.map(packageOption))}</select></label>${selected?safeHtml`<p class="cyber-note">${selected.asset} · ${selected.ecosystem} · ${selected.name} ${selected.version||'version unknown'}</p>${!canLookupPackage(selected)?safeHtml`<p>Version applicability unknown: ${selected.identityNote||'a supported identity and exact version are required.'}</p>`:safeHtml`<button data-env-action="plan-selected" data-id="${selected.id}">Review this package lookup</button>`}${lookup?safeHtml`<p class="cyber-note">OSV version query ${lookup.status} · attempted ${date(lookup.at)} ${Date.now()-lookup.at>7*86400000?'· older than seven days; explicitly recheck':''}. ${lookup.message}</p>${!lookup.advisories.length?safeHtml`<p>${lookup.status==='complete'?'No advisories returned for this declared package/version. This is not proof of safety.':'Lookup incomplete; coverage is unknown.'}</p>`:''}${joinSafeHtml(lookup.advisories.map(a=>safeHtml`<article class="cyber-card" data-env-advisory="${a.id}"><a class="cyber-headline" href="${safeUrlAttr(a.url)}" target="_blank" rel="noopener noreferrer">${a.id} ↗</a><p>${a.summary}</p><p class="cyber-note">Observed ${date(a.observedAt)} · source modified ${a.modified||'not supplied'} · aliases ${a.aliases.join(', ')||'none'}. OSV's query reports version applicability; local configuration, reachability and backports are not verified.</p>${a.fixes.length?safeHtml`<p>Provider fixed-version markers: ${a.fixes.join(', ')}. Read the advisory for branch/platform guidance; these are not automatic upgrade instructions.</p>`:''}${this.kevBadges([a.id,...a.aliases])}<button data-env-action="pin" data-id="${a.id}" ${s.tasks.some(t=>t.packageId===selected.id&&identityKey(t.packageSnapshot)===identityKey(selected)&&t.advisory.id===a.id)?safeHtml`disabled`:''}>Add to remediation list</button></article>`))}`:safeHtml`<p class="cyber-empty">No lookup evidence for this declaration. Importing inventory never performs a lookup.</p>`}<button data-env-action="kev">Refresh public KEV context</button>`:safeHtml`<p class="cyber-empty">Add declared inventory first.</p>`}`:safeHtml`<p class="cyber-note">Private workflow with frozen package/version and advisory snapshots. Resolved and accepted are manual states, not verified fixes. Inventory updates do not automatically close tasks. Exports include saved values and private notes.</p>${task?safeHtml`<label>Choose remediation task<select aria-label="Choose remediation task" data-env-task-select>${joinSafeHtml(s.tasks.map(t=>safeHtml`<option value="${t.id}" ${t.id===task.id?safeHtml`selected`:''}>${t.packageSnapshot.asset} · ${t.advisory.id} · ${t.status}</option>`))}</select></label>${this.taskForm(task,s.packages.find(p=>p.id===task.packageId))}`:safeHtml`<p class="cyber-empty">No remediation tasks. Pin an OSV version-query finding to track it privately.</p>`}`}</div>`);
    for(const d of this.content.querySelectorAll<HTMLDetailsElement>('details')){const previous=open.get(d.dataset.envDetails);if(previous!==undefined)d.open=previous;}
    if(focus){const fields=[...this.content.querySelectorAll<HTMLInputElement>('[data-env-manual],[data-env-task-field],[data-env-search]')];const el=fields.find(el=>(el.dataset.envManual||el.dataset.envTaskField||(el.dataset.envSearch!==undefined?'search':''))===focus);el?.focus({preventScroll:true});if(el&&caret)try{el.setSelectionRange(caret[0]??null,caret[1]??null);}catch{/* non-text controls */}}
  }
  override destroy():void{this.stopped=true;this.fileRevision++;cancelEnvironmentLookups();this.unsubscribe();window.removeEventListener('storage',this.onStorage);super.destroy();}
}
