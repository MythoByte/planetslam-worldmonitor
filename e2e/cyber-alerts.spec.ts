import {expect,test,type BrowserContext,type Page} from '@playwright/test';
import {seedAnonymousDashboard} from './bootstrap-request-budget-fixtures';
import {installCyberFixtures,cyberFixture} from './cyber-dashboard-fixtures';
import {evaluateCyberAlerts,freshCyberAlertStore} from '../src/services/cyber-alert-engine';
import type {CyberEnvelope,CyberKevData,CyberEpssData,CyberCvssData} from '../src/types/cyber-dashboard';
const KEY='planetslam-cyber-alerts-v1';
test.skip(process.env.VITE_BRAND!=='planetslam','Cyber is a PlanetSlam edition');
async function notifications(context:BrowserContext,permission='default'){
 await context.addInitScript((permission)=>{
  const w=window as any;w.__cyberNotices=[];w.__cyberPermissionCalls=0;
  class FixtureNotification {static permission=permission;static async requestPermission(){w.__cyberPermissionCalls++;FixtureNotification.permission='granted';return 'granted';}onclick:any;constructor(title:string,options:any){w.__cyberNotices.push({title,...options});}close(){} }
  Object.defineProperty(window,'Notification',{value:FixtureNotification,configurable:true});
 },permission);
}
async function boot(page:Page,store?:string){
 await seedAnonymousDashboard(page,'full',{initializeOnce:{sessionKey:'cyber-alerts-acceptance',clearStorage:true,localStorage:{'worldmonitor-theme':'dark','planetslam-cyber-watchlist-v1':'["docker"]',...(store?{[KEY]:store}:{})}}});
 await page.goto('/dashboard?variant=tech');await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready','true');
 const panel=page.locator('[data-panel="cyber-alerts"]');await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel.locator('.cyber-body')).toBeVisible();}).toPass({timeout:30000});return panel;
}
async function checked(page:Page){await expect.poll(()=>page.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key)||'null');return s?.kev!==null&&s?.lastCheckAt>0;},KEY)).toBe(true);}
function changed(probability:number){
 const kev=cyberFixture('kev').data as CyberKevData,epss=cyberFixture('epss').data as CyberEpssData,cvss=cyberFixture('cvss').data as CyberCvssData;
 return {kev:{data:{...kev,items:[...kev.items,{...kev.items[0],id:'CVE-2026-88888'}],totalCount:2}},epss:{data:{...epss,items:[...epss.items,{id:'CVE-2026-88888',probability,percentile:0.99}],requestedCount:2}},cvss:{data:{...cvss,items:[...cvss.items,{...cvss.items[0],id:'CVE-2026-88888'}]}}};
}
for(const width of [1440,390])test(`Cyber alerts baseline, thresholds, private browser notices and deduplication at ${width}px`,async({page,context},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await notifications(context);await page.setViewportSize({width,height:1000});await installCyberFixtures(page);const panel=await boot(page);
 await expect(panel).toContainText('Monitoring off');expect(await page.evaluate(()=>(window as any).__cyberPermissionCalls)).toBe(0);
 await panel.getByText('Alert rules and delivery',{exact:true}).click();await panel.getByRole('combobox',{name:'Minimum EPSS likelihood',exact:true}).selectOption('50');await panel.getByRole('combobox',{name:'Minimum technical severity',exact:true}).selectOption('7');
 await panel.getByRole('button',{name:'Enable monitoring',exact:true}).click();await checked(page);await expect(panel.locator('[data-alert-id]')).toHaveCount(0);
 await panel.getByRole('button',{name:'Enable browser notifications',exact:true}).click();await expect(panel).toContainText('Browser notifications enabled');expect(await page.evaluate(()=>(window as any).__cyberPermissionCalls)).toBe(1);
 await installCyberFixtures(page,changed(0.4));await panel.getByRole('button',{name:'Check cached feeds',exact:true}).click();await expect(panel.getByRole('button',{name:'Check cached feeds',exact:true})).toBeEnabled();await expect(panel.locator('[data-alert-id]')).toHaveCount(0);
 await installCyberFixtures(page,changed(0.8));await panel.getByRole('button',{name:'Check cached feeds',exact:true}).click();await expect(panel.locator('[data-alert-kind="vulnerability"]')).toHaveCount(1);await expect(panel).toContainText('CVE-2026-88888');
 await expect.poll(()=>page.evaluate(()=>(window as any).__cyberNotices.length)).toBe(1);const notice=await page.evaluate(()=>(window as any).__cyberNotices[0]);expect(JSON.stringify(notice)).not.toContain('docker');expect(JSON.stringify(notice)).not.toContain('CVE-');expect(notice.data.url).toBe('/dashboard?variant=tech');
 await panel.getByText('Alert rules and delivery',{exact:true}).click();await panel.locator('.panel-content').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:info.outputPath(`cyber-alerts-${width}.png`)});
 const second=await context.newPage();await installCyberFixtures(second,changed(0.8));await second.goto('/dashboard?variant=tech');await expect(async()=>{await second.locator('[data-panel="cyber-alerts"]').scrollIntoViewIfNeeded();await expect(second.locator('[data-alert-kind="vulnerability"]')).toHaveCount(1);}).toPass({timeout:20000});
 await panel.getByRole('button',{name:'Check cached feeds',exact:true}).click();await expect(panel.getByRole('button',{name:'Check cached feeds',exact:true})).toBeEnabled();expect(await second.evaluate(()=>(window as any).__cyberNotices.length)).toBe(0);
 await second.close();await panel.getByRole('button',{name:'Mark all read',exact:true}).click();await expect(panel.locator('[data-alert-kind="vulnerability"]')).toContainText('Read');await panel.getByRole('button',{name:'Clear inbox',exact:true}).click();await panel.getByRole('button',{name:'Check cached feeds',exact:true}).click();await expect(panel.locator('[data-alert-id]')).toHaveCount(0);
 await page.reload();await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel).toContainText('Monitoring enabled');}).toPass({timeout:20000});await checked(page);await expect(panel.locator('[data-alert-id]')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__cyberNotices.length)).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
test('daily browser digest catches up once without replay after reload',async({page,context},info)=>{
 await notifications(context,'granted');await installCyberFixtures(page);const now=Date.now(),s=freshCyberAlertStore();s.rules={...s.rules,enabled:true,browser:true,delivery:'daily'};
 const baseline=evaluateCyberAlerts(s,{kev:cyberFixture('kev'),incidents:cyberFixture('incidents'),health:cyberFixture('health')},['docker'],now-120000).store;
 baseline.nextDigestAt=now-1000;baseline.digestSince=now-120000;
 const panel=await boot(page,JSON.stringify(baseline));await expect(panel.locator('[data-alert-kind="digest"]')).toHaveCount(1);await expect(panel).toContainText('not proof of safety');await expect.poll(()=>page.evaluate(()=>(window as any).__cyberNotices.length)).toBe(1);
 await page.screenshot({path:info.outputPath('cyber-daily-digest.png')});await panel.getByRole('button',{name:'Check cached feeds',exact:true}).click();await expect(panel.getByRole('button',{name:'Check cached feeds',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).__cyberNotices.length)).toBe(1);
 await page.reload();await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel.locator('[data-alert-kind="digest"]')).toHaveCount(1);}).toPass({timeout:20000});expect(await page.evaluate(()=>(window as any).__cyberNotices.length)).toBe(0);
});
test('storage failures pause monitoring and recover without erasing saved state',async({page,context})=>{
 await notifications(context);await page.addInitScript(()=>{(window as any).__blockCyberStorage=true;const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='planetslam-cyber-alerts-v1'&&(window as any).__blockCyberStorage)throw Error('Synthetic quota');return set.call(this,key,value);};});await installCyberFixtures(page);const panel=await boot(page);
 await panel.getByRole('button',{name:'Enable monitoring',exact:true}).click();await expect(panel).toContainText('Browser storage could not be saved');expect(await page.evaluate(()=>(window as any).__cyberNotices.length)).toBe(0);
 await page.evaluate(()=>{(window as any).__blockCyberStorage=false;});await panel.getByRole('button',{name:'Retry browser storage',exact:true}).click();await expect(panel.getByRole('button',{name:'Enable monitoring',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Enable monitoring',exact:true}).click();await checked(page);await expect(panel.locator('[data-alert-id]')).toHaveCount(0);
});
test('source outage and recovery are confirmed across checks without browser permission prompts',async({page,context})=>{
 await notifications(context);await installCyberFixtures(page);const panel=await boot(page);await panel.getByRole('button',{name:'Enable monitoring',exact:true}).click();await checked(page);
 const health=cyberFixture('health').data as {items:CyberEnvelope[]};
 await installCyberFixtures(page,{health:{status:'stale',data:{items:health.items.map(e=>e.dataset==='bleeping'?{...e,status:'unavailable'}:e)}}});
 for(let n=0;n<2;n++){await panel.getByRole('button',{name:'Check cached feeds',exact:true}).click();await expect(panel.getByRole('button',{name:'Check cached feeds',exact:true})).toBeEnabled();if(n===0)await expect(panel.locator('[data-alert-id]')).toHaveCount(0);}
 await expect(panel.locator('[data-alert-kind="source"]')).toHaveCount(1);await expect(panel).toContainText('Cyber source unavailable');
 await installCyberFixtures(page);for(let n=0;n<2;n++){await panel.getByRole('button',{name:'Check cached feeds',exact:true}).click();await expect(panel.getByRole('button',{name:'Check cached feeds',exact:true})).toBeEnabled();}
 await expect(panel.locator('[data-alert-kind="source"]')).toHaveCount(2);await expect(panel).toContainText('Cyber source recovered');expect(await page.evaluate(()=>(window as any).__cyberPermissionCalls)).toBe(0);
});
test('denied browser permission leaves dashboard monitoring available',async({page,context})=>{
 await notifications(context,'denied');await installCyberFixtures(page);const panel=await boot(page);await panel.getByRole('button',{name:'Enable monitoring',exact:true}).click();await checked(page);
 await expect(panel).toContainText('Browser permission is denied');await expect(panel.getByRole('button',{name:'Enable browser notifications',exact:true})).toBeDisabled();expect(await page.evaluate(()=>(window as any).__cyberPermissionCalls)).toBe(0);
});
