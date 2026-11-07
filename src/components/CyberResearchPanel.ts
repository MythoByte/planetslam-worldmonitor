import { Panel } from './Panel';
import { fetchCyberDataset } from '@/services/cyber-dashboard';
import { getCyberResearchState,mutateCyberResearch } from '@/services/cyber-research';
import { CYBER_RESEARCH_KEY,captureResearch,filterResearch,researchGroups,relatedResearchNews,saveResearchInvestigation,researchJson,researchCsv,DEFAULT_RESEARCH_FILTERS,type ResearchRecord,type ResearchFilters,type CyberInvestigation } from '@/services/cyber-research-model';
import { safeHtml,safeUrlAttr,joinSafeHtml,type SafeHtml } from '@/utils/sanitize';
import type { CyberEnvelope,CyberIncidentData,CyberNewsData } from '@/types/cyber-dashboard';
import '@/styles/cyber.css';
const time=(n:number|null)=>n?new Date(n).toISOString().slice(0,16).replace('T',' ')+' UTC':'Not observed';
export class CyberResearchPanel extends Panel {
  private stopped=false;
  private loading=false;
  private timer:ReturnType<typeof setInterval>|null=null;
  private sample:CyberEnvelope<CyberIncidentData>|null=null;
  private news:CyberEnvelope<CyberNewsData>|null=null;
  private message='';
  private filters:ResearchFilters={...DEFAULT_RESEARCH_FILTERS};
  private view:'history'|'investigations'='history';
  private selected='';
  private visible=20;
  private draft:{id:string;title:string;notes:string;dirty:boolean;saved:CyberInvestigation}|null=null;
  private readonly onStorage=(e:StorageEvent)=>{if(e.key===CYBER_RESEARCH_KEY || e.key===null)this.render();};
  constructor(){
    super({id:'cyber-research',title:'Cyber Research Workbench',className:'cyber-panel',defaultRowSpan:3,
      infoTooltip:'Browser-observed incident sample, local investigations and exports. This is not a global incident database. Notes stay on this device.'});
    window.addEventListener('storage',this.onStorage);
    this.content.addEventListener('input',e=>{
      const el=e.target as HTMLInputElement;
      if(el.dataset.researchField==='query')this.filters.query=el.value.slice(0,160);
      if(this.draft && el.dataset.researchField==='title'){this.draft.title=el.value.slice(0,120);this.draft.dirty=true;}
      if(this.draft && el.dataset.researchField==='notes'){this.draft.notes=el.value.slice(0,4000);this.draft.dirty=true;}
    },{signal:this.signal});
    this.content.addEventListener('change',e=>{
      const el=e.target as HTMLSelectElement,key=el.dataset.researchFilter;
      if(key==='country'||key==='sector')this.filters[key]=el.value;
      if(key==='days')this.filters.days=Number(el.value);
      if(key){this.visible=20;this.render();}
      if(el.dataset.researchCase!==undefined){this.selected=el.value;this.draft=null;this.render();}
    },{signal:this.signal});
    this.content.addEventListener('click',e=>{const el=(e.target as HTMLElement).closest<HTMLElement>('[data-research-action]');if(el)void this.action(el.dataset.researchAction!,el.dataset.id||'');},{signal:this.signal});
    this.runWhenConnected(()=>{this.render();void this.fetchData();this.timer=setInterval(()=>{if(document.visibilityState!=='hidden'&&this.canHostLiveMedia())void this.fetchData();},60000);});
  }
  private async fetchData(force=false):Promise<void>{
    if(this.loading||this.stopped)return;
    this.loading=true;this.render();
    const [sample,news]=await Promise.allSettled([fetchCyberDataset<CyberIncidentData>('incidents',force),fetchCyberDataset<CyberNewsData>('news',force)]);
    if(this.stopped)return;
    this.sample=sample.status==='fulfilled'?sample.value:null;
    this.news=news.status==='fulfilled'?news.value:null;
    this.message=sample.status==='rejected'?'Current incident feed could not be reached. Local history and investigations are retained.':'';
    if(this.sample?.status==='fresh' && getCyberResearchState().store.captureEnabled){
      const observedAt=Date.now();let accepted=false;
      const ok=await mutateCyberResearch(s=>{if(this.stopped)return s;const next=captureResearch(s,this.sample!,observedAt);accepted=next.lastCaptureAt===observedAt;return next;});
      if(ok&&!accepted)this.message='The current sample could not be captured: its data is expired, invalid or older than the saved source snapshot. Local history was retained.';
    }
    if(this.stopped)return;
    this.loading=false;this.render();
  }
  private download(name:string,text:string,type:string):void{
    const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  private restoreDraftControls():void{
    const title=this.content.querySelector<HTMLInputElement>('[data-research-field="title"]');
    const notes=this.content.querySelector<HTMLTextAreaElement>('[data-research-field="notes"]');
    if(title)title.value=this.draft?.title??'';
    if(notes)notes.value=this.draft?.notes??'';
  }
  private async action(action:string,id:string):Promise<void>{
    this.message='';
    if(action==='history'||action==='investigations'){this.view=action;this.render();return;}
    if(action==='apply'){this.visible=20;this.render();return;}
    if(action==='more'){this.visible+=20;this.render();return;}
    if(action==='discard'){
      this.draft=null;this.render();
      // Form property edits do not change Panel's cached HTML. Restore the actual controls too.
      this.restoreDraftControls();
      return;
    }
    if(action==='filters-reset'){this.filters={...DEFAULT_RESEARCH_FILTERS};this.render();return;}
    if(action==='refresh'){await this.fetchData(true);return;}
    if(action==='retry'){await mutateCyberResearch(s=>s);this.render();return;}
    if(action==='reset'){await mutateCyberResearch(s=>s,true);this.selected='';this.draft=null;this.render();return;}
    if(action==='capture'){await mutateCyberResearch(s=>({...s,captureEnabled:!s.captureEnabled}));this.render();if(getCyberResearchState().store.captureEnabled)await this.fetchData(true);return;}
    if(action==='clear-history'){await mutateCyberResearch(s=>({...s,records:[],captureEnabled:false,firstCaptureAt:null,lastCaptureAt:null,lastSourceFetchedAt:null}));this.render();return;}
    const state=getCyberResearchState();if(state.blocked)return;
    if(action==='csv'){this.download('planetslam-cyber-observed-sample.csv',researchCsv(filterResearch(state.store.records,this.filters)),'text/csv;charset=utf-8');return;}
    if(action==='pin'){
      const evidence=state.store.records.find(r=>r.incident.id===id);if(!evidence)return;
      const related=this.news?.status!=='unavailable'&&this.news?.expiresAt&&this.news.expiresAt>Date.now()?relatedResearchNews(evidence.incident,this.news.data?.items||[]):[];
      const caseId=crypto.randomUUID();
      if(await mutateCyberResearch(s=>saveResearchInvestigation(s,evidence,related,caseId,Date.now(),this.news?.fetchedAt??null))){this.selected=caseId;this.draft=null;this.view='investigations';}
    }
    if(action==='save'&&this.draft){
      const draft={...this.draft};
      const ok=await mutateCyberResearch(s=>{
        const current=s.investigations.find(c=>c.id===draft.id);
        if(!current)throw new Error('This investigation was deleted in another tab. Copy your unsaved draft before choosing another investigation.');
        if(current.updatedAt!==draft.saved.updatedAt || current.title!==draft.saved.title || current.notes!==draft.saved.notes)throw new Error('Saved notes changed in another tab. Your unsaved draft is preserved. Reload saved notes before editing that version.');
        return {...s,investigations:s.investigations.map(c=>c.id===draft.id?{...c,title:draft.title.trim()||c.evidence.incident.organization.slice(0,120),notes:draft.notes,updatedAt:Date.now()}:c)};
      });if(ok){this.draft=null;this.message='Investigation saved on this device.';}
    }
    if(action==='delete'){
      if(await mutateCyberResearch(s=>({...s,investigations:s.investigations.filter(c=>c.id!==id)}))){this.selected='';this.draft=null;}
    }
    if(action==='json'){
      const c=state.store.investigations.find(c=>c.id===id);if(c)this.download(`planetslam-cyber-investigation-${c.id}.json`,researchJson(c),'application/json');return;
    }
    this.render();
  }
  private evidence(r:ResearchRecord):SafeHtml{
    const i=r.incident;
    return safeHtml`<div class="cyber-eyebrow">${i.countryCode} · ${i.sector} · ${i.category}</div><h3>${i.organization}</h3><p>${i.verification==='claim-reported'?'Claim in reporting · unverified':'Reported · research-coded, not independently verified'}</p><p>${i.description}</p><p class="cyber-note">Provider event date ${time(i.eventAt)} (may be estimated) · report date ${time(i.reportedAt)}. First seen in this browser ${time(r.firstSeenAt)}; last seen ${time(r.lastSeenAt)}. Provider fetched ${time(r.sourceFetchedAt)}.</p><a class="cyber-reference" href="${safeUrlAttr(i.url)}" target="_blank" rel="noopener noreferrer">Database record ↗</a>${i.reportUrl?safeHtml`<a class="cyber-reference" href="${safeUrlAttr(i.reportUrl)}" target="_blank" rel="noopener noreferrer">Original reporting ↗</a>`:''}<details class="cyber-timeline"><summary>${r.revisions.length} retained meaningful source changes</summary><p class="cyber-note">Up to five changed-field observations, not full prior record copies. Retrieval and provider revision timestamp changes alone are excluded.</p><ol>${joinSafeHtml(r.revisions.map(v=>safeHtml`<li>${time(v.at)} · ${v.fields.join(', ')} changed · provider fetched ${time(v.fetchedAt)}</li>`))}</ol></details>`;
  }
  private chart(title:string,rows:[string,number][],limit:number):SafeHtml{
    const max=Math.max(1,...rows.map(r=>r[1]));
    return safeHtml`<section class="cyber-research-chart"><h3>${title}</h3>${rows.length?joinSafeHtml(rows.slice(0,limit).map(([name,count])=>safeHtml`<div class="cyber-research-bar"><span>${name}</span><meter min="0" max="${max}" value="${count}" aria-label="${name}: ${count} sample records">${count}</meter><strong>${count}</strong></div>`)):safeHtml`<p class="cyber-note">No retained records match. This does not imply no incidents.</p>`}${rows.length>limit?safeHtml`<p class="cyber-note">Showing ${limit} of ${rows.length} represented groups.</p>`:''}</section>`;
  }
  private investigation(c:CyberInvestigation):SafeHtml{
    const draft=this.draft?.id===c.id&&this.draft.dirty?this.draft:{id:c.id,title:c.title,notes:c.notes,dirty:false,saved:structuredClone(c)};this.draft=draft;
    return safeHtml`<section data-research-investigation="${c.id}"><p class="cyber-note">Saved evidence snapshot ${time(c.savedAt)}. It is frozen; feed refreshes do not rewrite this evidence. Notes last saved ${time(c.updatedAt)}.</p><label class="cyber-research-label">Investigation title<input aria-label="Investigation title" data-research-field="title" maxlength="120" value="${draft.title}"></label><label class="cyber-research-label">Private notes<textarea aria-label="Private investigation notes" data-research-field="notes" maxlength="4000" rows="5">${draft.notes}</textarea></label><div class="cyber-toolbar"><button data-research-action="save">Save notes</button><button data-research-action="discard">Reload saved notes</button><button data-research-action="json" data-id="${c.id}">Export saved investigation JSON</button><button data-research-action="delete" data-id="${c.id}">Delete investigation</button></div><p class="cyber-note">JSON includes the saved notes and evidence, not unsaved edits. Notes stay in this browser until you export them.</p>${this.evidence(c.evidence)}<h3>Saved keyword-related reporting</h3><p class="cyber-note">Organization text matches from the seven-day news cache at save time, not proof of the same incident. Provider fetched ${time(c.relatedFetchedAt)}. No match does not mean no reporting.</p>${joinSafeHtml(c.related.map(n=>safeHtml`<article class="cyber-card"><a href="${safeUrlAttr(n.url)}" target="_blank" rel="noopener noreferrer">${n.title} ↗</a><p class="cyber-note">${n.publisher} · published ${time(n.publishedAt)}</p></article>`))}</section>`;
  }
  private render():void{
    if(this.stopped)return;
    const openSections=new Map([...this.content.querySelectorAll<HTMLDetailsElement>('details')].map(el=>[el.querySelector('summary')?.textContent,el.open]));
    const state=getCyberResearchState(),s=state.store;
    const active=document.activeElement as HTMLInputElement|null,field=active?.dataset.researchField,selection=active&&'selectionStart'in active?[active.selectionStart,active.selectionEnd]:null;
    const filtered=filterResearch(s.records,this.filters),countries=[...new Map(s.records.map(r=>[r.incident.countryCode,r.incident.country])).entries()].sort(),sectors=[...new Set(s.records.map(r=>r.incident.sector))].sort();
    const options=(key:'country'|'sector',rows:[string,string][])=>safeHtml`<label>${key==='country'?'Country':'Sector'}<select aria-label="Research ${key}" data-research-filter="${key}"><option value="">All</option>${joinSafeHtml(rows.map(([value,label])=>safeHtml`<option value="${value}" ${this.filters[key]===value?safeHtml`selected`:''}>${label}</option>`))}</select></label>`;
    const selected=s.investigations.find(c=>c.id===this.selected)||(this.draft?.dirty&&this.draft.id===this.selected?this.draft.saved:s.investigations[0]);
    if(selected)this.selected=selected.id;
    this.setSafeContentImmediate(safeHtml`<div class="cyber-body"><p class="cyber-note">Browser-observed incident sample · monthly research, not global attack statistics. History and private notes stay on this device. Source: <a class="cyber-research-source" href="https://cybereventsdatabase.org/" target="_blank" rel="noopener noreferrer">UMD GoTech ↗</a>.</p><details class="cyber-methodology"><summary>${s.captureEnabled?'Capture enabled':'Capture paused'} · ${s.records.length} retained · feed ${this.sample?.status||'unavailable'}</summary><div class="cyber-provenance"><strong>${s.captureEnabled?'Local capture enabled':'Local capture paused'}</strong><span>Current feed: ${this.sample?.status||'unavailable'}</span><span>${s.records.length} retained records / 200 maximum · 180 days since last observation</span><span>First capture ${time(s.firstCaptureAt)} · last capture ${time(s.lastCaptureAt)} · provider fetched ${time(s.lastSourceFetchedAt)}</span></div><p class="cyber-note">Capture runs only while this panel is open. Each ID counts once using its latest captured classification. Report weeks use provider publication dates, not capture dates. Unrepresented weeks are omitted, not asserted to have zero incidents. Clearing browser data removes local research.</p></details>${state.error||this.message?safeHtml`<p class="cyber-note" role="status">${state.error||this.message}</p>`:''}<div class="cyber-toolbar"><button data-research-action="refresh" ${this.loading?safeHtml`disabled`:''}>${this.loading?'Checking research cache…':'Refresh research cache'}</button><button data-research-action="capture" ${state.blocked?safeHtml`disabled`:''}>${s.captureEnabled?'Pause capture':'Resume capture'}</button>${state.error?safeHtml`<button data-research-action="retry">Retry research storage</button>`:''}${state.blocked?safeHtml`<button data-research-action="reset">Reset all research data</button>`:''}</div><nav class="cyber-toolbar" aria-label="Research views"><button data-research-action="history" aria-pressed="${this.view==='history'}">Observed history and trends</button><button data-research-action="investigations" aria-pressed="${this.view==='investigations'}">Saved investigations (${s.investigations.length})</button></nav>${this.view==='history'?safeHtml`<details class="cyber-methodology"><summary>Filter observed history</summary><div class="cyber-explore-filters">${options('country',countries.map(([code,name])=>[code,`${code} · ${name}`]))}${options('sector',sectors.map(v=>[v,v||'Unknown']))}<label>Report age<select aria-label="Research report age" data-research-filter="days">${joinSafeHtml([0,30,90,365].map(v=>safeHtml`<option value="${v}" ${this.filters.days===v?safeHtml`selected`:''}>${v?`Last ${v} days`:'All retained sample'}</option>`))}</select></label><label>Search history<input type="search" aria-label="Search observed history" data-research-field="query" maxlength="160" value="${this.filters.query}"></label><button data-research-action="apply">Apply history search</button><button data-research-action="filters-reset">Reset history filters</button></div></details><p class="cyber-note" data-research-count>${filtered.length} matching of ${s.records.length} retained sample records.</p><details class="cyber-methodology" open><summary>Sample trends and breakdowns</summary>${this.chart('By country · observed sample',researchGroups(filtered,'country'),6)}${this.chart('By sector · observed sample',researchGroups(filtered,'sector'),6)}${this.chart('Report weeks starting Monday (UTC) · latest 12 represented',researchGroups(filtered,'week'),12)}</details><div class="cyber-toolbar"><button data-research-action="csv" ${state.blocked?safeHtml`disabled`:''}>Export filtered sample CSV</button><button data-research-action="clear-history" ${state.blocked?safeHtml`disabled`:''}>Clear observed history and pause</button></div><p class="cyber-note">CSV exports all filtered records with source links, claim labels, provider and observation dates, and sample coverage. Saved investigations remain when history is cleared.</p>${joinSafeHtml(filtered.slice(0,this.visible).map(r=>safeHtml`<article class="cyber-card" data-research-record="${r.incident.id}">${this.evidence(r)}<button data-research-action="pin" data-id="${r.incident.id}" ${s.investigations.some(c=>c.evidence.incident.id===r.incident.id)||state.blocked?safeHtml`disabled`:''}>${s.investigations.some(c=>c.evidence.incident.id===r.incident.id)?'Investigation already saved':'Save investigation'}</button></article>`))}${filtered.length>this.visible?safeHtml`<p class="cyber-note">Showing ${this.visible} newest matching reports. CSV includes all matches.</p><button data-research-action="more">Show more observed records</button>`:''}`:safeHtml`<p class="cyber-note">Up to 30 investigations. Evidence and saved related links stay fixed, even after source edits, archive eviction or clearing observed history. Separate saved notes from unverified source claims.</p>${selected?safeHtml`<label>Choose investigation<select aria-label="Choose investigation" data-research-case>${joinSafeHtml(s.investigations.map(c=>safeHtml`<option value="${c.id}" ${selected.id===c.id?safeHtml`selected`:''}>${c.title}</option>`))}</select></label>${this.investigation(selected)}`:safeHtml`<p class="cyber-empty">No saved investigations. Choose Save investigation on a record in Observed history.</p>`}`}</div>`);
    for(const el of this.content.querySelectorAll<HTMLDetailsElement>('details')){const was=openSections.get(el.querySelector('summary')?.textContent);if(was!==undefined)el.open=was;}
    if(field){const el=[...this.content.querySelectorAll<HTMLInputElement>('[data-research-field]')].find(el=>el.dataset.researchField===field);el?.focus({preventScroll:true});if(el&&selection&&el.type!=='number')try{el.setSelectionRange(selection[0]??null,selection[1]??null);}catch{/* selects do not expose a text caret */}}
  }
  override destroy():void{this.stopped=true;if(this.timer)clearInterval(this.timer);window.removeEventListener('storage',this.onStorage);super.destroy();}
}
