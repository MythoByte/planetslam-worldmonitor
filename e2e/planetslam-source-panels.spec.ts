import { expect, test } from '@playwright/test';
test.skip(process.env.VITE_BRAND !== 'planetslam', 'PlanetSlam local-source panels');

for (const width of [1440, 390]) {
  test(`source-backed panels render and submit without Pro at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/tests/runtime-harness.html');
    await page.evaluate(async () => {
      const modules = await Promise.all([
        import('/src/styles/main.css'), import('/src/services/i18n.ts'), import('/src/app/data-loader.ts'),
        import('/src/components/StockAnalysisPanel.ts'), import('/src/components/StockBacktestPanel.ts'),
        import('/src/components/DailyMarketBriefPanel.ts'), import('/src/components/DeductionPanel.ts'),
        import('/src/services/stock-analysis.ts'), import('/src/services/daily-market-brief.ts'),
        import('/src/services/panel-gating.ts'),
      ]);
      const [, i18n, { DataLoaderManager }, { StockAnalysisPanel }, { StockBacktestPanel }, { DailyMarketBriefPanel }, { DeductionPanel }, stock, brief, gating] = modules;
      await i18n.initI18n();
      if (gating.hasPremiumAccess()) throw new Error('Acceptance must remain anonymous');
      const targets = stock.getStockAnalysisTargets();
      const snapshot = (symbol: string) => ({
        available: true, symbol, name: symbol, display: symbol, currency: 'USD', generatedAt: new Date().toISOString(),
        currentPrice: 100, signal: 'Hold', signalScore: 50, compositeScore: 50,
        ratingSignal: 'Hold', ratingSummary: 'Synthetic source acceptance', ratingAction: 'Monitor', ratingConfidence: 'Medium',
        ratingWhyNow: 'Stable', ratingBullishFactors: [], ratingRiskFactors: [], analystConsensus: {}, fundamentals: {},
        bullishFactors: [], riskFactors: [], headlines: [], supportLevels: [], resistanceLevels: [], recentUpgrades: [],
        latestSignal: 'Hold', winRate: 60, directionAccuracy: 60, avgSimulatedReturnPct: 2,
        actionableEvaluations: 10, totalSignals: 10, evalWindowDays: 10, results: [], evaluations: [], warnings: [],
      });
      const requested: string[] = [];
      window.fetch = async input => {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path = new URL(raw, location.origin).pathname;
        requested.push(path);
        let body: unknown = {};
        if (path.endsWith('/get-stock-analysis-history')) body = { items: targets.map(target => ({ symbol: target.symbol, snapshots: [snapshot(target.symbol)] })) };
        else if (path.endsWith('/list-stored-stock-backtests')) body = { items: targets.map(target => snapshot(target.symbol)) };
        else if (path.endsWith('/deduct-situation')) body = { analysis: 'Synthetic deduction: current source context supports this analysis.', model: 'acceptance', provider: 'fixture' };
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      };
      const absent = new DataLoaderManager({ panels: {}, isDestroyed: false, inFlight: new Set() } as never, {} as never);
      await absent.loadDailyMarketBrief();
      if (requested.length) throw new Error('An absent source panel must not load data');
      const daily = await brief.buildDailyMarketBrief({
        markets: [{ symbol: 'AAPL', name: 'Apple', display: 'AAPL', price: 100, change: 1, sparkline: [] }],
        targets: [{ symbol: 'AAPL', name: 'Apple', display: 'AAPL' }],
        newsByCategory: {}, timezone: 'UTC',
      });
      await brief.cacheDailyMarketBrief(daily);
      const panels = {
        'stock-analysis': new StockAnalysisPanel(), 'stock-backtest': new StockBacktestPanel(),
        'daily-market-brief': new DailyMarketBriefPanel(), deduction: new DeductionPanel(() => []),
      };
      const host = document.getElementById('runtime-harness')!;
      host.textContent = '';
      host.style.cssText = `display:grid;grid-template-columns:${innerWidth > 768 ? '1fr 1fr' : '1fr'};gap:16px;padding:16px;`;
      for (const panel of Object.values(panels)) {
        panel.getElement().style.cssText = 'height:520px;min-width:0;width:100%;';
        host.append(panel.getElement());
      }
      const ctx = { panels, isDestroyed: false, inFlight: new Set() };
      const loader = new DataLoaderManager(ctx as never, {} as never);
      const refresh = document.createElement('button'); refresh.textContent = 'Refresh local sources';
      refresh.addEventListener('click', () => { void Promise.all([loader.loadStockAnalysis(), loader.loadStockBacktest(), loader.loadDailyMarketBrief()]); });
      document.body.prepend(refresh);
    });
    await page.getByRole('button', { name: 'Refresh local sources', exact: true }).click();
    for (const id of ['stock-analysis', 'stock-backtest']) {
      await expect(page.locator(`[data-panel="${id}"] tr.watchlist-row`).first()).toBeVisible();
    }
    await expect(page.locator('[data-panel="daily-market-brief"]')).toContainText('Apple');
    await page.locator('.deduction-input').fill('Assess the current source context');
    await page.locator('.deduction-submit-btn').click();
    await expect(page.locator('.deduction-result')).toContainText('Synthetic deduction: current source context');
    await expect(page.locator('.panel-pro-badge, .panel-locked-cta')).toHaveCount(0);
    await expect(page.locator('.panel-title')).toHaveText(['Stock Analysis', 'Backtesting', 'Daily Market Brief', 'Deduct Situation']);
    if (width === 390) {
      for (const id of ['stock-analysis', 'stock-backtest', 'daily-market-brief', 'deduction']) {
        await page.locator(`[data-panel="${id}"]`).screenshot({ path: info.outputPath(`source-panels-${width}-${id}.png`) });
      }
    } else await page.screenshot({ path: info.outputPath(`source-panels-${width}.png`), fullPage: true });
  });
}
