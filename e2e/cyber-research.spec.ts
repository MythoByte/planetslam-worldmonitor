import {expect,test,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {seedAnonymousDashboard} from './bootstrap-request-budget-fixtures';
import {installCyberFixtures,cyberFixture} from './cyber-dashboard-fixtures';
import type {CyberIncidentData,CyberNewsData} from '../src/types/cyber-dashboard';
// Match the full Chromium browser used for the deployed review drive.
test.use({channel:'chromium'});
const KEY='planetslam-cyber-research-v1';
test.skip(process.env.VITE_BRAND!=='planetslam','Cyber is a PlanetSlam edition');
async function boot(page:Page){
 await seedAnonymousDashboard(page,'full',{initializeOnce:{sessionKey:'cyber-research-acceptance',clearStorage:true,localStorage:{'worldmonitor-theme':'dark'}}});
 await page.goto('/dashboard?variant=tech');await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready','true');
 const panel=page.locator('[data-panel=cyber-research]');await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel.locator('.cyber-body')).toBeVisible();}).toPass({timeout:30000});
 await expect(panel.locator('[data-research-count]')).toContainText('3 matching of 3');return panel;
}
async function refresh(panel:ReturnType<Page['locator']>){await panel.getByRole('button',{name:'Refresh research cache',exact:true}).click();await expect(panel.getByRole('button',{name:'Refresh research cache',exact:true})).toBeEnabled();}
async function downloaded(page:Page,click:()=>Promise<void>){const pending=page.waitForEvent('download');await click();const file=await pending;return readFile((await file.path())!,'utf8');}
for(const width of [1440,390])test(`local research filters, charts, frozen case notes and private exports at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const requests:string[]=[];page.on('request',r=>requests.push(r.url()+(r.postData()||'')));
 const news=cyberFixture('news').data as CyberNewsData;
 await installCyberFixtures(page,{news:{data:{items:[{...news.items[0],id:'related-1',title:'Synthetic Hospital disclosure',summary:'Keyword-related reporting, not a confirmed link.',url:'https://example.org/related'}]}}});
 const panel=await boot(page);await expect(panel).toContainText('not global attack statistics');await expect(panel.getByRole('meter',{name:/US.*1 sample records/})).toHaveCount(1);
 await panel.getByText('Filter observed history',{exact:true}).click();await panel.getByLabel('Research country',{exact:true}).selectOption('US');await expect(panel.locator('[data-research-count]')).toContainText('1 matching of 3');
 await panel.getByRole('button',{name:'Reset history filters',exact:true}).click();await expect(panel.locator('[data-research-count]')).toContainText('3 matching of 3');await panel.getByText('Filter observed history',{exact:true}).click();
 await panel.locator('.panel-content').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:info.outputPath(`cyber-research-trends-${width}.png`)});
 const card=panel.locator('[data-research-record="synthetic-us"]');await card.getByRole('button',{name:'Save investigation',exact:true}).click();await expect(panel.locator('[data-research-investigation]')).toHaveCount(1);await expect(panel).toContainText('Synthetic Hospital disclosure');
 await panel.getByLabel('Investigation title',{exact:true}).fill('Synthetic research case');await panel.getByLabel('Private investigation notes',{exact:true}).fill('PRIVATE-CYBER-NOTE <img src=x onerror=alert(1)>');await panel.getByRole('button',{name:'Save notes',exact:true}).click();await expect(panel.getByRole('status')).toContainText('saved on this device');
 await panel.getByLabel('Investigation title',{exact:true}).fill('Unsaved title to discard');await panel.getByLabel('Private investigation notes',{exact:true}).fill('Unsaved notes to discard');await panel.getByRole('button',{name:'Reload saved notes',exact:true}).click();await expect(panel.getByLabel('Investigation title',{exact:true})).toHaveValue('Synthetic research case');await expect(panel.getByLabel('Private investigation notes',{exact:true})).toHaveValue('PRIVATE-CYBER-NOTE <img src=x onerror=alert(1)>');
 const json=JSON.parse(await downloaded(page,()=>panel.getByRole('button',{name:'Export saved investigation JSON',exact:true}).click()));expect(json.investigation.notes).toContain('PRIVATE-CYBER-NOTE');expect(json.investigation.evidence.incident.id).toBe('synthetic-us');expect(json.coverage).toContain('Not global');expect(json.investigation.related).toHaveLength(1);
 await panel.locator('.panel-content').evaluate(el=>{el.scrollTop=240;});await page.screenshot({path:info.outputPath(`cyber-research-investigation-${width}.png`)});
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready','true');await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel.getByRole('button',{name:'Saved investigations (1)',exact:true})).toBeVisible();}).toPass({timeout:30000});await panel.getByRole('button',{name:'Saved investigations (1)',exact:true}).click();await expect(panel.getByLabel('Private investigation notes',{exact:true})).toHaveValue('PRIVATE-CYBER-NOTE <img src=x onerror=alert(1)>');expect(await panel.locator('img[src=x]').count()).toBe(0);
 await panel.getByRole('button',{name:'Observed history and trends',exact:true}).click();const csv=await downloaded(page,()=>panel.getByRole('button',{name:'Export filtered sample CSV',exact:true}).click());expect(csv).toContain('synthetic-us');expect(csv).toContain('claim-reported');expect(csv).not.toContain('PRIVATE-CYBER-NOTE');
 expect(requests.join('\n')).not.toContain('PRIVATE-CYBER-NOTE');expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('history accumulates meaningful revisions and remains through source outages; pinned evidence is immutable',async({page})=>{
 await installCyberFixtures(page);const panel=await boot(page);await panel.locator('[data-research-record="synthetic-us"]').getByRole('button',{name:'Save investigation',exact:true}).click();
 const initial=cyberFixture('incidents').data as CyberIncidentData;const changed={...initial,items:[{...initial.items[0],description:'Changed source detail'}, {...initial.items[0],id:'new-record',organization:'Another synthetic organization'}]};
 await installCyberFixtures(page,{incidents:{data:changed}});await refresh(panel);await panel.getByRole('button',{name:'Observed history and trends',exact:true}).click();await expect(panel.locator('[data-research-count]')).toContainText('4 matching of 4');await expect(panel.locator('[data-research-record="synthetic-us"]')).toContainText('1 retained meaningful source changes');
 await panel.getByRole('button',{name:'Saved investigations (1)',exact:true}).click();await expect(panel).toContainText('Synthetic reported event, not an actual incident.');await expect(panel).not.toContainText('Changed source detail');
 await installCyberFixtures(page,{incidents:{status:'unavailable',data:null}});await refresh(panel);await expect(panel).toContainText('feed unavailable');await panel.getByRole('button',{name:'Observed history and trends',exact:true}).click();await expect(panel.locator('[data-research-count]')).toContainText('4 matching of 4');
 await panel.getByRole('button',{name:'Clear observed history and pause',exact:true}).click();await expect(panel.locator('[data-research-count]')).toContainText('0 matching of 0');await expect(panel).toContainText('Capture paused');await expect(panel.getByRole('button',{name:'Saved investigations (1)',exact:true})).toBeVisible();
 await installCyberFixtures(page);await refresh(panel);await expect(panel.locator('[data-research-count]')).toContainText('0 matching of 0');await panel.getByRole('button',{name:'Resume capture',exact:true}).click();await expect(panel.locator('[data-research-count]')).toContainText('3 matching of 3');
});
test('corrupt research profiles are preserved until explicit reset',async({page})=>{
 await seedAnonymousDashboard(page,'full',{initializeOnce:{sessionKey:'corrupt-research',clearStorage:true,localStorage:{[KEY]:'{'}}});await installCyberFixtures(page);await page.goto('/dashboard?variant=tech');
 const panel=page.locator('[data-panel=cyber-research]');await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel).toContainText('Saved research data is invalid');}).toPass({timeout:30000});expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('{');
 await panel.getByRole('button',{name:'Reset all research data',exact:true}).click();await refresh(panel);await expect(panel.locator('[data-research-count]')).toContainText('3 matching of 3');
});
test('cross-tab note edits are detected and do not overwrite a conflicting saved version',async({page,context})=>{
 await installCyberFixtures(page);const panel=await boot(page);await panel.locator('[data-research-record="synthetic-us"]').getByRole('button',{name:'Save investigation',exact:true}).click();
 await panel.getByLabel('Private investigation notes',{exact:true}).fill('Unsent first-tab draft');
 const second=await context.newPage();await installCyberFixtures(second);await second.goto('/dashboard?variant=tech');const other=second.locator('[data-panel=cyber-research]');await expect(async()=>{await other.scrollIntoViewIfNeeded();await expect(other.getByRole('button',{name:'Saved investigations (1)',exact:true})).toBeVisible();}).toPass({timeout:30000});await other.getByRole('button',{name:'Saved investigations (1)',exact:true}).click();await other.getByLabel('Private investigation notes',{exact:true}).fill('Saved second-tab revision');await other.getByRole('button',{name:'Save notes',exact:true}).click();
 await expect(panel.getByLabel('Private investigation notes',{exact:true})).toHaveValue('Unsent first-tab draft');await panel.getByRole('button',{name:'Save notes',exact:true}).click();await expect(panel.getByRole('status')).toContainText('changed in another tab');expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).investigations[0].notes,KEY)).toBe('Saved second-tab revision');
 await panel.getByRole('button',{name:'Reload saved notes',exact:true}).click();await expect(panel.getByLabel('Private investigation notes',{exact:true})).toHaveValue('Saved second-tab revision');await second.close();
});
