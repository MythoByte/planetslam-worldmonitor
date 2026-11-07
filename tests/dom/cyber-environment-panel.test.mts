import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {initTestI18n} from './helpers/i18n.mts';
import {emptyEnvironment,manualEnvironmentPackage,pinEnvironmentTask,type EnvironmentStore} from '../../src/services/cyber-environment-model';
const f=vi.hoisted(()=>({store:null as EnvironmentStore|null,run:vi.fn(),cancel:vi.fn()}));
vi.mock('@/services/cyber-dashboard',()=>({fetchCyberDataset:async()=>({dataset:'kev',status:'unavailable',provider:'Synthetic',sourceUrl:'https://example.org',fetchedAt:null,observedAt:null,expiresAt:null,data:null})}));
vi.mock('@/services/cyber-environment',()=>({getEnvironmentState:()=>({store:f.store,blocked:false,error:null,progress:{running:false,done:0,total:0}}),subscribeEnvironment:()=>()=>{},cancelEnvironmentLookups:()=>f.cancel(),runEnvironmentLookups:f.run,mutateEnvironment:vi.fn()}));
import {CyberEnvironmentPanel} from '@/components/CyberEnvironmentPanel';
let panel:CyberEnvironmentPanel;
beforeAll(async()=>{await initTestI18n();});
beforeEach(()=>{
 const p=manualEnvironmentPackage({asset:'Synthetic asset',name:'lodash',version:'4.17.19',ecosystem:'npm'});f.store=pinEnvironmentTask({...emptyEnvironment(),packages:[p]},p,{id:'GHSA-synthetic-0001',summary:'Synthetic advisory',aliases:[],modified:'',published:'',url:'https://osv.dev/vulnerability/GHSA-synthetic-0001',fixes:[],observedAt:Date.now()});f.run.mockReset();f.cancel.mockReset();panel=new CyberEnvironmentPanel();document.body.appendChild(panel.getElement());panel.notifyConnected();
});
afterEach(()=>{panel.destroy();document.body.replaceChildren();});
it('showing a panel never starts OSV queries; hiding it cancels active work',()=>{
 expect(f.run).not.toHaveBeenCalled();panel.toggle(false);expect(f.cancel).toHaveBeenCalledOnce();panel.toggle(true);expect(f.run).not.toHaveBeenCalled();
});
it('reloading saved task fields restores actual DOM properties even when generated HTML is identical',async()=>{
 panel.getElement().querySelector<HTMLButtonElement>('[data-env-action="tasks"]')!.click();
 const notes=panel.getElement().querySelector<HTMLTextAreaElement>('[data-env-task-field="notes"]')!,owner=panel.getElement().querySelector<HTMLInputElement>('[data-env-task-field="owner"]')!;
 notes.value='Unsaved private draft';notes.dispatchEvent(new Event('input',{bubbles:true}));owner.value='Unsaved owner';owner.dispatchEvent(new Event('input',{bubbles:true}));
 panel.getElement().querySelector<HTMLButtonElement>('[data-env-action="task-reload"]')!.click();
 await vi.waitFor(()=>{expect(panel.getElement().querySelector<HTMLTextAreaElement>('[data-env-task-field="notes"]')!.value).toBe('');expect(panel.getElement().querySelector<HTMLInputElement>('[data-env-task-field="owner"]')!.value).toBe('');});
});
