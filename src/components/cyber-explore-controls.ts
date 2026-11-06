import { safeHtml, joinSafeHtml, type SafeHtml } from '@/utils/sanitize';
import { getCyberFilters, setCyberFilters, type CyberFilters } from '@/services/cyber-explore';
import type { CyberIncident, CyberInfrastructure } from '@/types/cyber-dashboard';
export function cyberExploreControls(incidents: CyberIncident[], infrastructure: CyberInfrastructure[], layers = false): SafeHtml {
  const f = getCyberFilters();
  const select = (key: 'country' | 'sector' | 'category' | 'days', title: string, values: Array<[string, string]>) => safeHtml`<label>${title}<select data-cyber-filter="${key}" aria-label="${title}">${joinSafeHtml(values.map(([value, label]) => safeHtml`<option value="${value}" ${f[key] === value ? safeHtml`selected` : ''}>${label}</option>`))}</select></label>`;
  const values = (items: string[], current: string): Array<[string, string]> => [['all', 'All'], ...[...new Set([...items, ...(current !== 'all' ? [current] : [])])].sort().map(v => [v, v === 'unknown' ? 'Unknown / unlocated' : v] as [string, string])];
  const countries = new Map([...incidents.map(i => [i.countryCode, i.country] as const), ...infrastructure.map(i => [i.countryCode, i.country] as const)]);
  const codes = values([...countries.keys()], f.country).map(([code, label]): [string, string] => [code, code === 'all' || code === 'unknown' ? label : `${code} · ${countries.get(code) || code}`]);
  return safeHtml`<div class="cyber-explore-filters">${select('country', 'Country', codes)}${select('sector', 'Sector (incidents)', values(incidents.map(i => i.sector), f.sector))}${select('category', 'Category', values([...incidents.map(i => i.category), ...infrastructure.map(i => i.category)], f.category))}${select('days', 'Reported / observed period', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last year'], ['all', 'All available']])}<label>Search records<input type="search" data-cyber-filter="query" aria-label="Search records" value="${f.query}" maxlength="100"></label>${layers ? safeHtml`<label><input type="checkbox" data-cyber-filter="incidents" ${f.incidents ? safeHtml`checked` : ''}> Reported incidents (amber)</label><label><input type="checkbox" data-cyber-filter="infrastructure" ${f.infrastructure ? safeHtml`checked` : ''}> Malicious infrastructure (violet)</label>` : ''}<button type="button" data-cyber-reset>Reset filters</button></div>`;
}
export function changeCyberFilter(event: Event): boolean {
  const input = event.target as HTMLInputElement;
  const key = input.dataset.cyberFilter as keyof CyberFilters | undefined;
  if (!key || !['country', 'sector', 'category', 'days', 'query', 'incidents', 'infrastructure'].includes(key)) return false;
  return setCyberFilters({ [key]: input.type === 'checkbox' ? input.checked : input.value });
}
