import type { MapLayers } from '@/types';

/** Presets configure one World workspace; they are not separate app variants. */
export const PLANETSLAM_DASHBOARDS = [
  { id: 'full', label: 'World', description: 'Global news, risks and activity', panels: ['live-news', 'insights', 'politics', 'middleeast', 'cii', 'strategic-risk', 'markets', 'economic', 'climate', 'earth-events', 'security-advisories', 'space-news', 'live-webcams'], layers: ['hotspots', 'natural', 'weather', 'waterways', 'sanctions', 'military', 'commercialShipping'] },
  { id: 'tech', label: 'Tech', description: 'Technology, startups and cyber intelligence', panels: ['tech', 'ai', 'startups', 'security', 'cyber-attention', 'cyber-incidents', 'cyber-kev', 'cyber-environment', 'cyber-research', 'cyber-alerts', 'cyber-brief', 'cyber-watchlist', 'cyber-health', 'tech-readiness', 'cloud', 'hardware', 'funding', 'economic'], layers: ['datacenters', 'startupHubs', 'techHQs', 'techEvents', 'cloudRegions', 'cables'] },
  { id: 'finance', label: 'Finance', description: 'Markets, economics and financial news', panels: ['markets', 'finance', 'heatmap', 'economic', 'trade-policy', 'sanctions-pressure', 'commodities', 'forex', 'bonds', 'crypto', 'polymarket', 'live-news'], layers: ['economic', 'financialCenters', 'stockExchanges', 'centralBanks', 'tradeRoutes'] },
  { id: 'commodity', label: 'Commodities', description: 'Resources, trade routes and supply chains', panels: ['commodity-news', 'commodities', 'energy', 'gold-silver', 'base-metals', 'mining-news', 'critical-minerals', 'markets', 'supply-chain', 'trade-policy', 'sanctions-pressure', 'economic', 'china-corridors'], layers: ['commodityHubs', 'miningSites', 'minerals', 'pipelines', 'commodityPorts', 'waterways', 'tradeRoutes'] },
  { id: 'energy', label: 'Energy', description: 'Energy prices, infrastructure and disruptions', panels: ['energy-complex', 'energy', 'renewable', 'supply-chain', 'trade-policy', 'sanctions-pressure', 'markets', 'economic', 'ukmto-incidents', 'climate', 'live-news'], layers: ['pipelines', 'storageFacilities', 'waterways', 'commodityPorts', 'sanctions', 'renewableInstallations'] },
  { id: 'happy', label: 'Good News', description: 'Positive stories and human progress', panels: ['positive-feed', 'progress', 'counters', 'spotlight', 'breakthroughs', 'digest', 'species', 'renewable', 'giving'], layers: ['positiveEvents', 'kindness', 'happiness', 'speciesRecovery', 'renewableInstallations'] },
] as const satisfies readonly { id: string; label: string; description: string; panels: readonly string[]; layers: readonly (keyof MapLayers)[] }[];

export type PlanetSlamDashboardId = typeof PLANETSLAM_DASHBOARDS[number]['id'];
export function isPlanetSlamDashboardId(value: unknown): value is PlanetSlamDashboardId {
  return PLANETSLAM_DASHBOARDS.some(preset => preset.id === value);
}
export function getPlanetSlamDashboard(value: PlanetSlamDashboardId) {
  return PLANETSLAM_DASHBOARDS.find(preset => preset.id === value)!;
}
