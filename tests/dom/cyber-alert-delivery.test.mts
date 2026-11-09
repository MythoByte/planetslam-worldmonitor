import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({fetch:vi.fn(),request:vi.fn(),show:vi.fn(),construct:vi.fn()}));
vi.mock('@/services/cyber-dashboard',()=>({fetchCyberDataset:f.fetch}));
vi.mock('@/services/cyber-watchlist',async(importOriginal)=>({ ...await importOriginal<typeof import('@/services/cyber-watchlist')>(),getCyberWatchlist:()=>['docker'],subscribeCyberWatchlist:()=>()=>{} }));
const KEY='planetslam-cyber-alerts-v1';
let api:typeof import('@/services/cyber-alerts');let stop:(()=>void)|undefined;let ids:string[];
let Permission: {permission:NotificationPermission;requestPermission:()=>Promise<NotificationPermission>};
beforeEach(async()=>{
 vi.resetModules();const memory=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);},clear:()=>memory.clear()});ids=['CVE-2026-99999'];f.request.mockReset();f.show.mockReset().mockResolvedValue(undefined);f.construct.mockReset();f.fetch.mockReset();
 class NativeNotice {static permission:NotificationPermission='granted';static requestPermission=f.request;onclick:any;constructor(title:string,options:any){f.construct(title,options);}close(){}}
 Permission=NativeNotice;vi.stubGlobal('Notification',NativeNotice);vi.stubGlobal('isSecureContext',true);
 vi.stubGlobal('navigator',{locks:{request:async(_name:string,action:()=>unknown)=>action()},serviceWorker:{getRegistration:async()=>({active:{},showNotification:f.show})}});
 f.fetch.mockImplementation(async(dataset:string)=>({dataset,status:'fresh',provider:'Synthetic',sourceUrl:'https://example.org',fetchedAt:Date.now(),observedAt:Date.now(),expiresAt:Date.now()+3600000,data:dataset==='health'?{items:[]} : dataset==='incidents'?{items:[]}:{items:ids.map(id=>({id,vendor:'Docker',product:'Engine',title:'Synthetic',url:'https://example.org/cve'}))}}));
 api=await import('@/services/cyber-alerts');stop=api.startCyberAlerts();
});
afterEach(()=>{stop?.();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
async function enable(){await api.updateCyberAlertRules({enabled:true});await vi.waitFor(()=>expect(api.getCyberAlertState().store.kev).not.toBeNull());await vi.waitFor(()=>expect(api.getCyberAlertState().checking).toBe(false));}
it('mounting never fetches or requests permission when monitoring is off',()=>{expect(f.fetch).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();expect(f.show).not.toHaveBeenCalled();});
it('a permission response cannot re-enable delivery after monitoring was disabled',async()=>{
 await enable();Permission.permission='default';let finish!:(p:NotificationPermission)=>void;f.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=api.enableCyberBrowserNotifications();expect(f.request).toHaveBeenCalledOnce();await api.updateCyberAlertRules({enabled:false,browser:false});finish('granted');await pending;
 expect(api.getCyberAlertState().store.rules.browser).toBe(false);expect(f.show).not.toHaveBeenCalled();
});
it('service-worker delivery uses opaque metadata and an uncertain failure is not replayed',async()=>{
 await enable();await api.enableCyberBrowserNotifications();await vi.waitFor(()=>expect(api.getCyberAlertState().checking).toBe(false));
 ids.push('CVE-2026-88888');f.show.mockRejectedValueOnce(Error('Synthetic delivery failure'));await api.checkCyberAlerts(true);
 expect(f.show).toHaveBeenCalledOnce();const [title,options]=f.show.mock.calls[0]!;expect(title).toBe('PlanetSlam Tech');expect(JSON.stringify(options)).not.toMatch(/docker|CVE-/i);expect(options.data.url).toBe('/dashboard?variant=tech');expect(api.getCyberAlertState().store.events).toHaveLength(1);
 await api.checkCyberAlerts(true);expect(f.show).toHaveBeenCalledOnce();expect(f.construct).not.toHaveBeenCalled();
});
it('a failed persistence step sends nothing and retry preserves the baseline until storage recovers',async()=>{
 await enable();await api.enableCyberBrowserNotifications();await vi.waitFor(()=>expect(api.getCyberAlertState().checking).toBe(false));
 const previous=localStorage.getItem(KEY);const write=localStorage.setItem.bind(localStorage);let blocked=true;
 vi.spyOn(localStorage,'setItem').mockImplementation((key,value)=>{if(key===KEY&&blocked)throw Error('Synthetic quota');return write(key,value);});
 ids.push('CVE-2026-88888');await api.checkCyberAlerts(true);expect(f.show).not.toHaveBeenCalled();expect(localStorage.getItem(KEY)).toBe(previous);expect(api.getCyberAlertState().storageFault).toBe(true);
 blocked=false;await api.checkCyberAlerts(true);expect(f.show).toHaveBeenCalledOnce();expect(api.getCyberAlertState().store.events).toHaveLength(1);expect(api.getCyberAlertState().storageFault).toBe(false);
});

it('failed reads are not treated as an empty profile and cannot overwrite saved alerts',async()=>{
 await enable();const previous=localStorage.getItem(KEY),get=localStorage.getItem.bind(localStorage);
 vi.spyOn(localStorage,'getItem').mockImplementation(key=>{if(key===KEY)throw Error('Synthetic unreadable storage');return get(key);});
 expect(api.getCyberAlertState().storageFault).toBe(true);await api.updateCyberAlertRules({enabled:false});await api.checkCyberAlerts(true);
 expect(f.show).not.toHaveBeenCalled();expect(get(KEY)).toBe(previous);
});
it('releasing the last panel owner cancels an in-flight check before saving or native delivery',async()=>{
 await enable();await api.enableCyberBrowserNotifications();await vi.waitFor(()=>expect(api.getCyberAlertState().checking).toBe(false));
 const original=f.fetch.getMockImplementation()!;let finish!:(value:unknown)=>void;
 f.fetch.mockImplementation((dataset:string)=>dataset==='kev'?new Promise(resolve=>{finish=resolve;}):original(dataset));
 const pending=api.checkCyberAlerts(true);stop?.();stop=undefined;ids.push('CVE-2026-88888');finish(await original('kev'));await pending;
 expect(api.getCyberAlertState().store.events).toHaveLength(0);expect(f.show).not.toHaveBeenCalled();
});
