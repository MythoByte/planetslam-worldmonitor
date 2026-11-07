import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {initTestI18n} from './helpers/i18n.mts';
const f=vi.hoisted(()=>({active:0,start:vi.fn()}));
vi.mock('@/services/cyber-alerts',async()=>{
 const {freshCyberAlertStore}=await import('@/services/cyber-alert-engine');
 return {getCyberAlertState:()=>({store:freshCyberAlertStore(),error:null,storageFault:false,checking:false,coverage:[],supported:false,coordinated:true,permission:'unsupported'}),subscribeCyberAlerts:()=>()=>{},startCyberAlerts:()=>f.start(),updateCyberAlertRules:vi.fn(),mutateCyberAlertInbox:vi.fn(),enableCyberBrowserNotifications:vi.fn(),checkCyberAlerts:vi.fn()};
});
import {CyberAlertsPanel} from '@/components/CyberAlertsPanel';
let panel:CyberAlertsPanel;
beforeAll(async()=>{await initTestI18n();});
beforeEach(()=>{f.active=0;f.start.mockReset().mockImplementation(()=>{f.active++;let stopped=false;return()=>{if(!stopped){stopped=true;f.active--;}};});panel=new CyberAlertsPanel();document.body.appendChild(panel.getElement());panel.notifyConnected();});
afterEach(()=>{panel.destroy();document.body.replaceChildren();});
it('disabling through the real Panel.toggle stops its monitoring lease and enabling restarts exactly once',()=>{
 expect(f.active).toBe(1);panel.toggle(false);expect(f.active).toBe(0);panel.toggle(false);expect(f.active).toBe(0);panel.toggle(true);expect(f.active).toBe(1);panel.toggle(true);expect(f.active).toBe(1);expect(f.start).toHaveBeenCalledTimes(2);panel.destroy();expect(f.active).toBe(0);
});
