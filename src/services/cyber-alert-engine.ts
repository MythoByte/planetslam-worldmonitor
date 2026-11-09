import { cyberMatches } from './cyber-watchlist';
import type { CyberEnvelope, CyberKevData, CyberEpssData, CyberCvssData, CyberIncidentData, CyberHealthData } from '@/types/cyber-dashboard';
export type AlertKind = 'vulnerability' | 'incident' | 'source' | 'digest';
export interface CyberAlertRules { enabled: boolean; browser: boolean; vulnerabilities: boolean; incidents: boolean; sources: boolean; epssMin: number; cvssMin: number; incidentDays: number; incidentScope: 'all' | 'watchlist'; sourceChecks: number; delivery: 'realtime' | 'daily'; digestHour: number }
export const DEFAULT_CYBER_ALERT_RULES: CyberAlertRules = { enabled: false, browser: false, vulnerabilities: true, incidents: true, sources: true, epssMin: 0, cvssMin: 0, incidentDays: 90, incidentScope: 'all', sourceChecks: 2, delivery: 'realtime', digestHour: 8 };
export interface CyberAlert { id: string; kind: AlertKind; title: string; message: string; url: string; at: number; read: boolean }
export interface CyberAlertStore {
  version: 1; rules: CyberAlertRules; signature: string; kev: [string, boolean][] | null; incidents: [string, string][] | null;
  health: [string, string][] | null; pending: [string, string, number][]; events: CyberAlert[]; seen: [string, number][];
  nextDigestAt: number | null; digestSince: number | null; lastDigestDay: string | null; lastCheckAt: number | null;
}
export type CyberAlertInputs = Partial<Record<'kev' | 'epss' | 'cvss' | 'incidents' | 'health', CyberEnvelope<unknown>>>;
const DAY = 86400000;
export const ALERT_RETENTION_MS = 30 * DAY;
const feedNames = ['brief', 'kev', 'epss', 'cvss', 'incidents', 'infrastructure', 'bleeping', 'krebs', 'hackernews'];
const kinds = ['vulnerability', 'incident', 'source', 'digest'];
export function validAlertUrl(value: string): boolean { if (value === '/dashboard?variant=tech' || value === '/dashboard?variant=cyber') return true; try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
export function freshCyberAlertStore(): CyberAlertStore { return { version: 1, rules: { ...DEFAULT_CYBER_ALERT_RULES }, signature: '', kev: null, incidents: null, health: null, pending: [], events: [], seen: [], nextDigestAt: null, digestSince: null, lastDigestDay: null, lastCheckAt: null }; }
export function normalizeCyberAlertRules(value: unknown): CyberAlertRules {
  const r = value && typeof value === 'object' ? value as Partial<CyberAlertRules> : {};
  return { enabled: r.enabled === true, browser: r.browser === true, vulnerabilities: r.vulnerabilities !== false, incidents: r.incidents !== false, sources: r.sources !== false,
    epssMin: [0, 10, 50, 90].includes(r.epssMin ?? -1) ? r.epssMin! : 0, cvssMin: [0, 7, 9].includes(r.cvssMin ?? -1) ? r.cvssMin! : 0,
    incidentDays: [7, 30, 90].includes(r.incidentDays ?? -1) ? r.incidentDays! : 90, incidentScope: r.incidentScope === 'watchlist' ? 'watchlist' : 'all',
    sourceChecks: [2, 3, 5].includes(r.sourceChecks ?? -1) ? r.sourceChecks! : 2, delivery: r.delivery === 'daily' ? 'daily' : 'realtime',
    digestHour: Number.isInteger(r.digestHour) && r.digestHour! >= 0 && r.digestHour! <= 23 ? r.digestHour! : 8 };
}
export function parseCyberAlertStore(raw: string | null, now = Date.now()): CyberAlertStore | null {
  if (raw === null) return freshCyberAlertStore();
  if (raw.length > 2000000) return null;
  try {
    const s = JSON.parse(raw) as CyberAlertStore;
    const stamp = (n: unknown) => n === null || typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= now + DAY;
    const pairs = (v: unknown, max: number, validate: (a: unknown[]) => boolean) => v === null || Array.isArray(v) && v.length <= max && v.every(a => Array.isArray(a) && a.length === 2 && validate(a)) && new Set(v.map(a => a[0])).size === v.length;
    if (!s || s.version !== 1 || !s.rules || typeof s.rules !== 'object' || Array.isArray(s.rules) || typeof s.signature !== 'string' || s.signature.length > 4000
      || !pairs(s.kev, 10000, a => typeof a[0] === 'string' && /^CVE-\d{4}-\d{4,}$/.test(a[0]) && typeof a[1] === 'boolean')
      || !pairs(s.incidents, 1000, a => typeof a[0] === 'string' && /^[\w-]{1,80}$/.test(a[0]) && typeof a[1] === 'string' && /^[a-f0-9]{8}$/.test(a[1]))
      || !pairs(s.health, 16, a => feedNames.includes(a[0] as string) && ['fresh', 'stale', 'unavailable'].includes(a[1] as string))
      || !Array.isArray(s.pending) || s.pending.length > 16 || !s.pending.every(a => Array.isArray(a) && a.length === 3 && feedNames.includes(a[0]) && ['fresh','stale','unavailable'].includes(a[1]) && Number.isInteger(a[2]) && a[2] >= 1 && a[2] <= 5)
      || !Array.isArray(s.events) || s.events.length > 200 || !s.events.every(e => e && typeof e.id === 'string' && e.id.length <= 180 && kinds.includes(e.kind) && typeof e.title === 'string' && e.title.length <= 160 && typeof e.message === 'string' && e.message.length <= 600 && typeof e.url === 'string' && e.url.length <= 4096 && validAlertUrl(e.url) && Number.isFinite(e.at) && e.at > 0 && e.at <= now + 60000 && typeof e.read === 'boolean')
      || new Set(s.events.map(e => e.id)).size !== s.events.length
      || !Array.isArray(s.seen) || !pairs(s.seen, 1000, a => typeof a[0] === 'string' && a[0].length <= 180 && typeof a[1] === 'number' && Number.isFinite(a[1]) && a[1] > 0 && a[1] <= now + 60000)
      || !stamp(s.nextDigestAt) || !stamp(s.digestSince) || !stamp(s.lastCheckAt) || s.lastDigestDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(s.lastDigestDay)) return null;
    return { ...s, rules: normalizeCyberAlertRules(s.rules) };
  } catch { return null; }
}
function hash(text: string): string { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return (value >>> 0).toString(16).padStart(8, '0'); }
export function cyberAlertNotificationTag(id: string): string { return `planetslam-cyber-${hash(id)}`; }
function nextDigest(now: number, hour: number): number { const d = new Date(now), at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour); return at > now ? at : at + DAY; }
function data<T>(e: CyberEnvelope<unknown> | undefined, now: number): T | null { return e?.status === 'fresh' && e.expiresAt !== null && e.expiresAt > now ? e.data as T : null; }
export function evaluateCyberAlerts(previous: CyberAlertStore, inputs: CyberAlertInputs, terms: string[], now = Date.now()): { store: CyberAlertStore; added: CyberAlert[] } {
  const s = structuredClone(previous), r = s.rules, added: CyberAlert[] = [];
  if (!r.enabled) return { store: s, added };
  const signature = JSON.stringify([r.vulnerabilities, r.incidents, r.sources, r.epssMin, r.cvssMin, r.incidentDays, r.incidentScope, r.sourceChecks, [...terms].sort()]);
  if (s.signature !== signature) { s.signature = signature; s.kev = null; s.incidents = null; s.health = null; s.pending = []; }
  s.events = s.events.filter(e => now - e.at < ALERT_RETENTION_MS);
  const seen = new Map(s.seen.filter(([,at]) => now - at < ALERT_RETENTION_MS));
  const add = (id: string, kind: AlertKind, title: string, message: string, url: string) => {
    if (seen.has(id) || !validAlertUrl(url)) return;
    const event = { id, kind, title: title.slice(0,160), message: message.slice(0,600), url, at: now, read: false };
    seen.set(id, now); s.events.unshift(event); added.push(event);
  };
  const kev = data<CyberKevData>(inputs.kev, now), epss = data<CyberEpssData>(inputs.epss, now), cvss = data<CyberCvssData>(inputs.cvss, now);
  // If an active threshold source fails, retain its baseline instead of interpreting missing scores as zero.
  if (r.vulnerabilities && kev && (!r.epssMin || epss) && (!r.cvssMin || cvss)) {
    const old = s.kev === null ? null : new Map(s.kev), values = new Map(old ?? []), probabilities = new Map(epss?.items.map(i => [i.id,i.probability])), scores = new Map(cvss?.items.map(i => [i.id,i.score]));
    for (const item of kev.items.slice(0,10000)) {
      const matches = cyberMatches(`${item.vendor} ${item.product} ${item.title}`, terms);
      const qualifies = matches.length > 0 && (!r.epssMin || (probabilities.get(item.id) ?? -1) >= r.epssMin / 100) && (!r.cvssMin || (scores.get(item.id) ?? -1) >= r.cvssMin);
      if (old !== null && qualifies && old.get(item.id) !== true) add(`kev:${item.id}:${hash(signature)}`, 'vulnerability', 'Watchlist vulnerability meets your rules', `${item.id} · ${item.vendor} ${item.product}. Keyword: ${matches.join(', ')}. CISA lists evidence of exploitation; this does not establish local exposure.`, item.url);
      values.set(item.id, qualifies);
    }
    s.kev = [...values].slice(-10000);
  }
  const incidents = data<CyberIncidentData>(inputs.incidents, now);
  if (r.incidents && incidents) {
    const old = s.incidents === null ? null : new Map(s.incidents), values = new Map(old ?? []);
    for (const item of incidents.items.slice(0,20)) {
      const revision = hash(JSON.stringify([item.organization,item.category,item.countryCode,item.description,item.verification,item.eventAt,item.reportedAt,item.reportUrl,item.changeLog]));
      const matches = cyberMatches(`${item.organization} ${item.description} ${item.sector}`, terms);
      const eligible = item.reportedAt >= now - r.incidentDays * DAY && item.reportedAt <= now && (r.incidentScope === 'all' || matches.length > 0);
      if (old !== null && old.get(item.id) !== revision && eligible) add(`incident:${item.id}:${revision}`, 'incident', old.has(item.id) ? 'Reported incident record updated' : 'New research record observed', `${item.organization} · ${item.category}. Reported ${new Date(item.reportedAt).toISOString().slice(0,10)}. Monthly research sample; claims are not independently verified.`, item.reportUrl || item.url);
      values.set(item.id,revision);
    }
    s.incidents = [...values].slice(-1000);
  }
  const health = inputs.health;
  if (r.sources && health?.data && health.expiresAt !== null && health.expiresAt > now) {
    const items = (health.data as CyberHealthData).items;
    const old = s.health === null ? null : new Map(s.health), values = new Map(old ?? []), pending = new Map(s.pending.map(([id,status,count]) => [id,{status,count}]));
    for (const item of items.slice(0,16)) {
      if (!feedNames.includes(item.dataset)) continue;
      const was = old?.get(item.dataset);
      if (was === undefined) { values.set(item.dataset,item.status); continue; }
      if (was === item.status) { pending.delete(item.dataset); continue; }
      const p = pending.get(item.dataset), count = p?.status === item.status ? p.count + 1 : 1;
      if (count < r.sourceChecks) { pending.set(item.dataset,{status:item.status,count}); continue; }
      add(`source:${item.dataset}:${item.status}:${now}`, 'source', item.status === 'fresh' ? 'Cyber source recovered' : item.status === 'stale' ? 'Cyber source refresh delayed' : 'Cyber source unavailable', `${item.provider}: ${was} → ${item.status} across ${r.sourceChecks} checks. This describes data retrieval, not attack activity.`, item.sourceUrl);
      values.set(item.dataset,item.status);pending.delete(item.dataset);
    }
    s.health = [...values]; s.pending = [...pending].map(([id,p]) => [id,p.status,p.count]);
  }
  s.digestSince ??= now; s.nextDigestAt ??= nextDigest(now,r.digestHour);
  const today = new Date(now).toISOString().slice(0,10);
  if (now >= s.nextDigestAt && s.lastDigestDay === today) s.nextDigestAt = nextDigest(now,r.digestHour);
  if (now >= s.nextDigestAt && s.lastDigestDay !== today) {
    const events = s.events.filter(e => e.kind !== 'digest' && e.at > s.digestSince! && e.at <= now);
    add(`digest:${today}`, 'digest', 'Cyber alert daily digest', `${events.length} alerts retained since ${new Date(s.digestSince).toISOString().slice(0,16)} UTC: ${events.filter(e=>e.kind==='vulnerability').length} vulnerabilities, ${events.filter(e=>e.kind==='incident').length} research updates, ${events.filter(e=>e.kind==='source').length} source changes. Only activity observed while monitoring ran is covered; no recorded alerts is not proof of safety.`, '/dashboard?variant=tech');
    s.digestSince = now; s.lastDigestDay = today; s.nextDigestAt = nextDigest(now,r.digestHour);
  }
  s.lastCheckAt = now; s.events = s.events.slice(0,200); s.seen = [...seen].slice(-1000);
  return { store: s, added };
}
