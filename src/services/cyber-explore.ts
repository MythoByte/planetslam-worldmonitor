import { safeStorageGet, safeStorageSetChecked, isStorageAvailable } from '@/utils/safe-storage';
import type { CyberIncident, CyberInfrastructure } from '@/types/cyber-dashboard';
import type { CyberMapSnapshot } from '@/types/cyber-map';
export interface CyberFilters { country: string; sector: string; category: string; days: string; query: string; incidents: boolean; infrastructure: boolean }
const KEY = 'planetslam-cyber-explore-v1';
const EVENT = 'planetslam:cyber-filters';
export const DEFAULT_CYBER_FILTERS: CyberFilters = { country: 'all', sector: 'all', category: 'all', days: '90', query: '', incidents: true, infrastructure: true };
function normalize(raw: unknown): CyberFilters {
  const r = raw && typeof raw === 'object' ? raw as Partial<CyberFilters> : {};
  const text = (v: unknown, fallback: string, max: number) => typeof v === 'string' && v.length <= max ? v : fallback;
  return { country: text(r.country, 'all', 20), sector: text(r.sector, 'all', 160), category: text(r.category, 'all', 160),
    days: ['7', '30', '90', '365', 'all'].includes(r.days ?? '') ? r.days! : '90', query: text(r.query, '', 100),
    incidents: r.incidents !== false, infrastructure: r.infrastructure !== false };
}
let memory: CyberFilters | null = null;
function read(): CyberFilters { try { return normalize(JSON.parse(safeStorageGet(KEY) || '{}')); } catch { return { ...DEFAULT_CYBER_FILTERS }; } }
export function getCyberFilters(): CyberFilters { return { ...(memory ??= read()) }; }
export function setCyberFilters(patch: Partial<CyberFilters>): boolean {
  memory = normalize({ ...getCyberFilters(), ...patch });
  const saved = isStorageAvailable() && safeStorageSetChecked(KEY, JSON.stringify(memory));
  window.dispatchEvent(new Event(EVENT)); return saved;
}
export function subscribeCyberFilters(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) { memory = read(); callback(); } };
  window.addEventListener(EVENT, callback); window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', onStorage); };
}
function match(country: string, category: string, text: string, at: number, f: CyberFilters, now: number): boolean {
  return (f.country === 'all' || f.country === country) && (f.category === 'all' || f.category === category)
    && (!f.query.trim() || text.toLowerCase().includes(f.query.toLowerCase().trim()))
    && at <= now + 60_000 && (f.days === 'all' || at >= now - Number(f.days) * 86400_000);
}
export function filterCyberIncidents(items: CyberIncident[], f = getCyberFilters(), now = Date.now()): CyberIncident[] {
  return items.filter(i => (f.sector === 'all' || i.sector === f.sector)
    && match(i.countryCode, i.category, `${i.organization} ${i.description} ${i.sector}`, i.reportedAt, f, now));
}
export function filterCyberInfrastructure(items: CyberInfrastructure[], f = getCyberFilters(), now = Date.now()): CyberInfrastructure[] {
  return items.filter(i => match(i.countryCode, i.category, `${i.indicator} ${i.source} ${i.category}`, i.observedAt, f, now));
}
export function cyberMapSnapshot(incidents: CyberIncident[], infrastructure: CyberInfrastructure[], f = getCyberFilters()): CyberMapSnapshot {
  return { markers: [
    ...(f.incidents ? filterCyberIncidents(incidents, f).filter(i => i.latitude !== null && i.longitude !== null).map(i => ({ id: i.id, kind: 'incident' as const,
      label: i.organization, country: i.country, category: i.category, latitude: i.latitude!, longitude: i.longitude! })) : []),
    ...(f.infrastructure ? filterCyberInfrastructure(infrastructure, f).filter(i => i.latitude !== null && i.longitude !== null).slice(0, 500).map(i => ({ id: i.id, kind: 'infrastructure' as const,
      label: defangCyberIndicator(i.indicator), country: i.country, category: i.category, latitude: i.latitude!, longitude: i.longitude! })) : []),
  ] };
}
export function defangCyberIndicator(text: string): string { return text.replace(/^https?:/i, 'hxxps:').replace(/\./g, '[.]'); }
