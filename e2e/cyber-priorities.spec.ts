import {expect,test} from '@playwright/test';
import {seedAnonymousDashboard} from './bootstrap-request-budget-fixtures';
import {installCyberFixtures} from './cyber-dashboard-fixtures';
test.skip(process.env.VITE_BRAND!=='planetslam','Cyber is a PlanetSlam edition');
async function boot(page: import('@playwright/test').Page) {
 await seedAnonymousDashboard(page,'full',{initializeOnce:{sessionKey:'priority-acceptance',clearStorage:true,localStorage:{'worldmonitor-theme':'dark'}}});
 await page.goto('/dashboard?variant=tech');
 await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready','true');
 await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready','true');
 const panel=page.locator('[data-panel="cyber-attention"]');
 await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel).toContainText('EPSS likelihood: 72.00%');}).toPass({timeout:30000});return panel;
}
for(const width of [1440,390]) test(`Attention Queue sources, filters and live watchlist at ${width}px`,async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:1000});await installCyberFixtures(page);
 const panel=await boot(page);
 await expect(panel).toContainText('CVSS 3.1 9.8/10');await expect(panel).toContainText('Synthetic CNA');
 await expect(panel).toContainText('Higher likelihood');
 await panel.getByRole('combobox',{name:'Technical severity',exact:true}).selectOption('Unknown');await expect(panel).toContainText('No entries match');
 await panel.getByRole('button',{name:'Reset queue filters'}).click();
 await panel.getByRole('combobox',{name:'Vendor',exact:true}).selectOption('Synthetic Vendor');await expect(panel.locator('[data-priority-cve]')).toHaveCount(1);
 await panel.getByRole('combobox',{name:'Product',exact:true}).selectOption('Docker');
 await panel.getByRole('textbox',{name:'Search vulnerabilities',exact:true}).fill('does-not-exist');await panel.getByRole('textbox',{name:'Search vulnerabilities',exact:true}).press('Tab');await expect(panel).toContainText('No entries match');
 await panel.getByRole('button',{name:'Reset queue filters'}).click();
 const watch=page.locator('[data-panel="cyber-watchlist"]');await expect(async()=>{await watch.scrollIntoViewIfNeeded();await expect(watch.getByRole('button',{name:'+ Docker',exact:true})).toBeVisible();}).toPass({timeout:20000});
 await watch.getByRole('button',{name:'+ Docker',exact:true}).click();await panel.scrollIntoViewIfNeeded();await expect(panel).toContainText('Watchlist priority');await expect(panel).toContainText('Watchlist keyword match: docker');
 await panel.getByLabel('Watchlist matches only',{exact:true}).check();await expect(panel.locator('[data-priority-cve]')).toHaveCount(1);
 await panel.locator('.panel-content').evaluate(el=>{el.scrollTop=0;});
 await page.screenshot({path:info.outputPath(`cyber-attention-${width}.png`)});
 await info.attach('Attention Queue with synthetic KEV, EPSS and CVSS data',{path:info.outputPath(`cyber-attention-${width}.png`),contentType:'image/png'});
 await panel.locator('[data-priority-cve]').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath(`cyber-attention-card-${width}.png`)});
 await page.reload();await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel).toContainText('Watchlist priority');}).toPass({timeout:20000});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
test('missing enrichment keeps KEV usable; refresh recovers scores',async({page},info)=>{
 await installCyberFixtures(page,{epss:{status:'unavailable',data:null},cvss:{status:'unavailable',data:null}});
 await seedAnonymousDashboard(page,'full',{initializeOnce:{sessionKey:'priority-outage',clearStorage:true}});await page.goto('/dashboard?variant=tech');
 const panel=page.locator('[data-panel="cyber-attention"]');await expect(async()=>{await panel.scrollIntoViewIfNeeded();await expect(panel).toContainText('EPSS unavailable');}).toPass({timeout:30000});
 await expect(panel.locator('[data-priority-cve]')).toHaveCount(1);await expect(panel).toContainText('Technical severity: Unknown');await expect(panel).not.toContainText('EPSS likelihood: 0.00%');
 await page.screenshot({path:info.outputPath('cyber-priority-outage.png')});
 await installCyberFixtures(page);await panel.getByRole('button',{name:'Refresh queue'}).click();await expect(panel).toContainText('EPSS likelihood: 72.00%');await expect(panel).toContainText('CVSS 3.1 9.8/10');
});
