const KEY = 'planetslam-cyber-watchlist-v1';
const EVENT = 'planetslam:cyber-watchlist';
export const CYBER_WATCH_LIMIT = 20;
export const CYBER_WATCH_PRESETS = ['Linux', 'Docker', 'Nextcloud', 'Microsoft', 'Chrome', 'Firefox', 'Fortinet', 'Cisco'];
function normalize(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string')
    .map(v => v.trim().replace(/\s+/g, ' ').slice(0, 60)).filter(v => v.length >= 2).map(v => v.toLowerCase()))].slice(0, CYBER_WATCH_LIMIT) : [];
}
export function getCyberWatchlist(): string[] {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}
export function saveCyberWatchlist(terms: string[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(normalize(terms))); window.dispatchEvent(new Event(EVENT)); return true; } catch { return false; }
}
export function subscribeCyberWatchlist(callback: () => void): () => void {
  const storage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) callback(); };
  window.addEventListener(EVENT, callback); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage); };
}
/** Literal term matching, with boundaries to avoid matching e.g. "Go" in "Google". */
export function cyberMatches(text: string, terms = getCyberWatchlist()): string[] {
  return terms.filter(term => new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text));
}
