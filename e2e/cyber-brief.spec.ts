import {expect,test} from '@playwright/test';
import {seedAnonymousDashboard} from './bootstrap-request-budget-fixtures';
import {installCyberFixtures,cyberFixture} from './cyber-dashboard-fixtures';
import type {CyberBriefData} from '../src/types/cyber-dashboard';
test.skip(process.env.VITE_BRAND!=='planetslam','Cyber is a PlanetSlam edition');
async function boot(page:import('@playwright/test').Page){
 await seedAnonymousDashboard(page,'full',{initializeOnce:{sessionKey:'cyber-brief-test',clearStorage:true,localStorage:{'worldmonitor-theme':'dark'}}});
 await page.goto('/dashboard?variant=cyber');await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready','true');
 const panel=page.locator('[data-panel="cyber-brief"]');await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel.locator('.cyber-body')).toBeVisible();}).toPass({timeout:30000});return panel;
}
for(const width of [1440,390])test(`Cyber daily brief sources, dated context and local watchlist at ${width}px`,async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:1000});await installCyberFixtures(page);const panel=await boot(page);
 await expect(panel).toContainText('AI-curated source digest');await expect(panel).toContainText('Reporting window:');await expect(panel).toContainText('Selected by synthetic-model');
 await expect(panel.locator('img')).toHaveCount(0);await expect(panel).toContainText('<img src=x onerror=alert(1)>');
 await expect(panel.locator('[data-brief-kind="research"]')).toContainText('Older research context');
 await expect(panel.getByRole('link',{name:'Synthetic Docker daily report'})).toHaveAttribute('href','https://example.org/daily-news');
 await panel.getByText('Source coverage · 4 evidence candidates',{exact:true}).click();await expect(panel).toContainText('krebs: unavailable');await panel.getByText('Source coverage · 4 evidence candidates',{exact:true}).click();
 await panel.locator('.panel-content').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:info.outputPath(`cyber-brief-${width}.png`)});
 const watch=page.locator('[data-panel="cyber-watchlist"]');await expect(async()=>{await watch.scrollIntoViewIfNeeded();await expect(watch.getByRole('button',{name:'+ Linux',exact:true})).toBeVisible();}).toPass({timeout:20000});await watch.getByRole('button',{name:'+ Linux',exact:true}).click();
 const local=panel.locator('[data-brief-watchlist]');await local.scrollIntoViewIfNeeded();await expect(local).toContainText('Synthetic Linux notice');await expect(local).toContainText('Watchlist keyword: linux');
 expect(await panel.locator('.cyber-brief-section').first().textContent()).not.toContain('Synthetic Linux notice');
 await page.screenshot({path:info.outputPath(`cyber-brief-watchlist-${width}.png`)});
 await page.reload();await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel.locator('[data-brief-watchlist]')).toContainText('Synthetic Linux notice');}).toPass({timeout:20000});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
test('Cyber daily brief identifies source fallback, previous-day data and cache-only retry recovery',async({page},info)=>{
 const fixture=cyberFixture('brief').data as CyberBriefData;
 await installCyberFixtures(page,{brief:{status:'stale',data:{...fixture,mode:'source-summary',model:null,aiStatus:'failed'}}});const panel=await boot(page);
 await expect(panel).toContainText('Previous UTC day brief');await expect(panel).toContainText('AI curation was unavailable');await expect(panel).not.toContainText('AI-curated source digest');
 await page.screenshot({path:info.outputPath('cyber-brief-fallback.png')});
 await installCyberFixtures(page,{brief:{status:'unavailable',data:null,message:'Synthetic brief outage.'}});await panel.getByRole('button',{name:'Refresh cached brief'}).click();await expect(panel).toContainText('Synthetic brief outage.');
 await installCyberFixtures(page);await panel.getByRole('button',{name:'Refresh cached brief'}).click();await expect(panel).toContainText('AI-curated source digest');
});
