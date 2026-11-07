import { cyberMatches } from './cyber-watchlist';
import type { CyberKevItem, CyberEpssData, CyberCvssData } from '@/types/cyber-dashboard';
export function cvssSeverity(score: number | null): string {
  return score === null ? 'Unknown' : score >= 9 ? 'Critical' : score >= 7 ? 'High' : score >= 4 ? 'Medium' : score > 0 ? 'Low' : 'None';
}
export interface PriorityFilters { query: string; vendor: string; product: string; severity: string; days: string; watched: boolean; sort: string }
export const DEFAULT_PRIORITY_FILTERS: PriorityFilters = { query: '', vendor: 'all', product: 'all', severity: 'all', days: 'all', watched: false, sort: 'attention' };
export function prioritizeCyber(kev: CyberKevItem[], epss: CyberEpssData | null, cvss: CyberCvssData | null, terms: string[], f = DEFAULT_PRIORITY_FILTERS, now = Date.now()) {
  const likelihoods = new Map(epss?.items.map(i => [i.id, i])), severities = new Map(cvss?.items.map(i => [i.id, i]));
  return kev.map(item => {
    const matches = cyberMatches(`${item.vendor} ${item.product} ${item.title}`, terms);
    const probability = likelihoods.get(item.id) ?? null, metric = severities.get(item.id) ?? null;
    return { item, matches, epss: probability, cvss: metric, severity: cvssSeverity(metric?.score ?? null),
      tier: matches.length ? 'Watchlist priority' : probability && probability.probability >= 0.1 ? 'Higher likelihood' : 'Known exploitation' };
  }).filter(r => (!f.query.trim() || `${r.item.id} ${r.item.vendor} ${r.item.product} ${r.item.title}`.toLowerCase().includes(f.query.trim().toLowerCase()))
    && (f.vendor === 'all' || r.item.vendor === f.vendor) && (f.product === 'all' || r.item.product === f.product)
    && (f.severity === 'all' || r.severity === f.severity) && (!f.watched || r.matches.length > 0)
    && (f.days === 'all' || r.item.addedAt >= now - Number(f.days) * 86400000))
    .sort((a, b) => (f.sort === 'attention' ? Number(b.matches.length > 0) - Number(a.matches.length > 0) : 0)
      || (f.sort === 'newest' ? b.item.addedAt - a.item.addedAt : (b.epss?.probability ?? -1) - (a.epss?.probability ?? -1))
      || b.item.addedAt - a.item.addedAt || a.item.id.localeCompare(b.item.id));
}
