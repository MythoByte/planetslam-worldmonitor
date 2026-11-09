/** Panels whose inputs can be served by the operator's existing price/news/LLM sources. */
export const PLANETSLAM_SOURCE_PANEL_NAMES: Readonly<Record<string, string>> = {
  'stock-analysis': 'Stock Analysis',
  'stock-backtest': 'Backtesting',
  'daily-market-brief': 'Daily Market Brief',
  deduction: 'Deduct Situation',
};

/** Explicit self-hosted methods; no hosted briefs, user data or seed-only feeds. */
export const PLANETSLAM_LOCAL_ANALYSIS_ROUTES: Readonly<Record<string, string>> = {
  '/api/market/v1/analyze-stock': 'GET',
  '/api/market/v1/get-stock-analysis-history': 'GET',
  '/api/market/v1/backtest-stock': 'GET',
  '/api/market/v1/list-stored-stock-backtests': 'GET',
  '/api/intelligence/v1/deduct-situation': 'POST',
  '/api/news/v1/summarize-article': 'POST',
};
