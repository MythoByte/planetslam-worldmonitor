import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';

test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam homepage only');

const headlines = [
  'Acceptance test: Pacific storm warning near island communities',
  'Fixture report: Central bank publishes interest-rate decision',
  'Browser scenario: Satellite mission reaches its planned orbit',
  'Synthetic briefing: Port cargo volumes expand in Europe',
  'Test dispatch: Researchers publish coral reef survey',
  'Layout fixture: Northern rail services resume after repairs',
  'Trial bulletin: Museum opens a new archaeology exhibition',
  'Quality check: River monitoring network measures water levels',
  'Demo dispatch: Coastal ferry operators announce timetable changes',
  'Sample notice: University observatory prepares a public lecture',
  'Verification story: Agricultural exporters revise wheat forecasts',
  'Controlled report: Local wildlife reserve records nesting birds',
  'Mock update: Desert solar facility connects to the national grid',
  'Example analysis: Library digitization grants support rural archives',
  'Test forecast: Mountain vineyards assess early spring frost',
  'Sample interview: Engineers demonstrate a reusable ocean sensor',
  'Synthetic notice: Competition officials publish athletics schedules',
  'Browser fixture: Dairy cooperatives evaluate cold storage equipment',
  'Controlled digest: National census office releases migration tables',
  'Acceptance dispatch: Film festival announces documentary awards',
];

const marketQuotes = [
  { symbol: 'AAPL', name: 'Apple', display: 'AAPL' },
  { symbol: '^GSPC', name: 'S&P 500', display: 'SPX' },
  { symbol: 'NVDA', name: 'NVIDIA', display: 'NVDA' },
  { symbol: '^DJI', name: 'Dow Jones', display: 'DOW' },
  { symbol: '^IXIC', name: 'NASDAQ Composite', display: 'COMP' },
].map((quote, index) => ({ ...quote, price: 100 + index, change: 1, sparkline: [99, 100, 101] }));

for (const width of [1440, 1024, 390]) {
  test(`homepage discovery and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedAnonymousDashboard(page, 'full', {
      initializeOnce: { sessionKey: 'ps-home-profile', clearStorage: true, localStorage: {
        'mobile-map-collapsed': 'false',
        'worldmonitor-panels': JSON.stringify({
          politics: { name: 'World News', enabled: true, priority: 0 },
          'threat-timeline': { name: 'Threat Timeline', enabled: true, priority: 1 },
          cii: { name: 'Country Instability', enabled: true, priority: 1 },
          'strategic-posture': { name: 'AI Strategic Posture', enabled: true, priority: 1 },
          markets: { name: 'Markets', enabled: true, priority: 1 },
        }),
      } },
    });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
    await page.route('**/api/health?*', route => route.fulfill({ json: {
      checkedAt: new Date().toISOString(), checks: { newsInsights: { status: 'OK', records: headlines.length, seedAgeMin: 0 } },
    } }));
    await page.route('**/api/news/v1/list-feed-digest*', route => route.fulfill({ json: {
      categories: { politics: { items: headlines.map((title, index) => ({
        source: 'BBC World', title,
        link: `https://example.com/bulletin/${index}`, publishedAt: Date.now(), isAlert: false,
      })) } }, feedStatuses: {}, generatedAt: new Date().toISOString(),
    } }));
    await page.route('**/api/market/v1/list-market-quotes*', route => route.fulfill({ json: {
      quotes: marketQuotes, finnhubSkipped: false, rateLimited: false, unavailableSymbols: [], asOf: new Date().toISOString(),
    } }));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-ps-home', 'true', { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Global situation' })).toBeVisible();
    await expect(page.locator('#mapContainer')).toHaveClass(/deckgl-mode|svg-mode/, { timeout: 60_000 });
    await expect(page.locator('.ps-layer-list button').first()).toBeAttached();
    await expect(page.locator('.ps-health')).toContainText('Feed coverage');
    await expect(page.locator('.ps-alerts')).toContainText('not supplied');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 1440) expect(await page.locator('#mapSection').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(650);
    await expect(page.locator('.ps-intelligence [data-panel="strategic-posture"]')).toHaveCount(0);
    if (width === 1440) {
      const accessibility = await new AxeBuilder({ page }).include('.ps-header').include('.ps-intro').include('.ps-utility').include('.ps-alerts').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(accessibility.violations).toEqual([]);
    }

    const drawer = page.locator('.ps-layer-drawer');
    if (!(await drawer.getAttribute('open') !== null)) await drawer.locator(':scope > summary').click();
    await page.getByRole('searchbox', { name: 'Search map layers' }).fill('conflict');
    const layer = page.locator('.ps-layer-list button[data-layer="conflicts"]');
    await expect(layer).toBeVisible();
    const pressed = await layer.getAttribute('aria-pressed');
    await layer.click();
    await expect(layer).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('worldmonitor-layers') || '{}').conflicts)).toBe(pressed !== 'true');
    await expect.poll(() => page.locator('.ps-button-primary').getAttribute('href')).toContain('layers=');
    await layer.click();
    await page.getByRole('searchbox', { name: 'Search map layers' }).fill('');

    const panel = page.locator('[data-panel="politics"].ps-module');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible();
    await expect(panel.locator('.item').first()).toBeVisible();
    await expect(panel.locator('.windowed-chunk')).toHaveCount(3);
    await expect(panel.locator('.item:visible')).toHaveCount(3);
    await panel.getByRole('button', { name: 'Show full module', exact: true }).click();
    await expect(panel.locator('.item:visible')).toHaveCount(headlines.length);
    await panel.getByRole('button', { name: 'Show summary', exact: true }).click();
    await expect(panel.locator('.item:visible')).toHaveCount(3);
    await panel.locator('.panel-header').scrollIntoViewIfNeeded();
    expect(await page.locator('.ps-header').evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThan(2);
    const workspaceOrder = await page.evaluate(() => localStorage.getItem('panel-order'));
    await page.screenshot({ path: `docs/planetslam/homepage-evidence/home-${width}.png` });
    await panel.getByRole('button', { name: 'Toggle World News' }).click();
    await expect(panel).toHaveClass(/ps-collapsed/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ps-home', 'true');
    await expect(page.locator('[data-panel="politics"].ps-module')).toHaveClass(/ps-collapsed/);
    await page.getByRole('button', { name: 'Reset homepage layout' }).click();
    await expect(page.locator('[data-panel="politics"].ps-module')).not.toHaveClass(/ps-collapsed/);
    expect(await page.evaluate(() => localStorage.getItem('panel-order'))).toBe(workspaceOrder);
    await page.locator('#mapFullscreenBtn').click();
    await expect(page.locator('#mapSection')).toHaveClass(/live-news-fullscreen/);
    expect(await page.locator('#mapSection').evaluate(el => Math.abs(el.getBoundingClientRect().height - innerHeight))).toBeLessThan(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mapSection')).not.toHaveClass(/live-news-fullscreen/);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `docs/planetslam/homepage-evidence/overview-${width}.png` });
    await page.locator('.ps-header').getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible();
    await page.keyboard.press('Escape');
    if (width < 1101) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'PlanetSlam' })).toBeVisible();
    }
    await page.locator(width < 1101 ? '.ps-nav-settings' : '.ps-header > button').filter({ hasText: 'Customize' }).click();
    await expect(page.locator('#us-theme')).toBeVisible();
    await page.locator('.unified-settings-close').click();
    if (width < 1101) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const markets = page.locator('[data-panel="markets"].ps-module');
    await markets.scrollIntoViewIfNeeded();
    await expect(markets.locator('[data-market-symbol]')).toHaveCount(3);
    expect(await markets.locator('[data-market-symbol]').evaluateAll(rows => rows.map(row => row.getAttribute('data-market-symbol')))).toEqual(['^GSPC', '^DJI', '^IXIC']);
    expect(await markets.locator('[data-market-chart]').evaluateAll(rows => rows.map(row => row.getAttribute('data-market-chart')))).toEqual(['1', '3', '4']);
    if (width === 1440) {
      await markets.locator('[data-market-symbol="^GSPC"]').click();
      await expect(page.locator('.market-chart-name')).toHaveText('S&P 500');
      await page.locator('.market-chart-close').click();
    }
    await expect(markets.getByRole('button', { name: 'Show full module', exact: true })).toHaveCount(0);
    if (width >= 768) {
      await expect.poll(() => page.locator('#panelsGrid').evaluate(grid => {
        const cards = [...grid.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.matches('.ps-module, .ps-directory-card'));
        const boxes = cards.map(card => card.getBoundingClientRect()).filter(box => box.height > 0);
        return boxes.every((box, index) => boxes.every((other, otherIndex) => index === otherIndex || box.right <= other.left + 1 || other.right <= box.left + 1 || box.bottom <= other.top + 1 || other.bottom <= box.top + 1));
      })).toBe(true);
    }
    await markets.locator('.panel-header').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect(markets.locator('[data-market-symbol]').last()).toBeInViewport();
    await page.screenshot({ path: `docs/planetslam/homepage-evidence/indices-${width}.png` });
    // Exercise network emulation once, after the other viewport contexts have
    // finished: Chromium can broadcast ERR_NETWORK_CHANGED across contexts.
    if (width === 390) {
      await page.context().setOffline(true);
      await expect(page.locator('.ps-health')).toContainText('Offline');
      await page.context().setOffline(false);
    }
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
    await expect(page.locator('.ps-header')).toHaveCount(0);
    await expect(page.locator('#panelsGrid [data-panel="politics"]')).toBeAttached();
    const fullMarkets = page.locator('#panelsGrid [data-panel="markets"]');
    await fullMarkets.scrollIntoViewIfNeeded();
    await expect(fullMarkets.locator('[data-market-symbol="AAPL"]')).toBeVisible();
    await expect(fullMarkets.locator('[data-market-symbol]')).toHaveCount(marketQuotes.length);
  });
}
