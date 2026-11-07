import type { CyberEnvelope, CyberIncident, CyberIncidentData, CyberNewsItem } from '@/types/cyber-dashboard';

export const CYBER_RESEARCH_KEY = 'planetslam-cyber-research-v1';
export const RESEARCH_LIMIT = 200;
export const INVESTIGATION_LIMIT = 30;
export const RESEARCH_RETENTION = 180 * 86400000;
const MAX_STORAGE_CHARS = 2000000;
export interface ResearchRevision { at: number; fetchedAt: number; fields: string[] }
export interface ResearchRecord {
  incident: CyberIncident; firstSeenAt: number; lastSeenAt: number; sourceFetchedAt: number;
  revisions: ResearchRevision[];
}
export interface CyberInvestigation {
  id: string; title: string; notes: string; savedAt: number; updatedAt: number;
  evidence: ResearchRecord; related: CyberNewsItem[]; relatedFetchedAt: number | null;
}
export interface CyberResearchStore {
  version: 1; captureEnabled: boolean; records: ResearchRecord[]; investigations: CyberInvestigation[];
  firstCaptureAt: number | null; lastCaptureAt: number | null; lastSourceFetchedAt: number | null;
}
export interface ResearchFilters { country: string; sector: string; days: number; query: string }
export const DEFAULT_RESEARCH_FILTERS: ResearchFilters = { country: '', sector: '', days: 0, query: '' };
const fields: (keyof CyberIncident)[] = ['organization','country','countryCode','sector','category','description','eventAt','reportedAt','verification','url','reportUrl','changeLog'];
const labels: Record<string,string> = { organization:'organization',country:'country',countryCode:'country code',sector:'sector',category:'category',description:'description',eventAt:'event date',reportedAt:'report date',verification:'claim label',url:'database source',reportUrl:'original reporting',changeLog:'provider change log' };
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
export function researchUrl(v: unknown): v is string {
  if (!text(v,2048)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
function stamp(v: unknown, now: number): v is number { return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now + 60000; }
function incident(v: unknown, now: number): v is CyberIncident {
  if (!v || typeof v !== 'object') return false;
  const i = v as CyberIncident;
  return typeof i.id === 'string' && /^[\w-]{1,80}$/.test(i.id)
    && text(i.organization,300) && text(i.country,160) && typeof i.countryCode === 'string' && /^(?:[A-Z]{2}|unknown)$/.test(i.countryCode)
    && text(i.sector,160) && text(i.category,160) && text(i.description,1200) && text(i.changeLog,1000)
    && stamp(i.eventAt,now) && stamp(i.reportedAt,now) && (i.updatedAt === null || stamp(i.updatedAt,now))
    && ['reported','claim-reported'].includes(i.verification) && researchUrl(i.url) && (i.reportUrl === '' || researchUrl(i.reportUrl))
    && (i.latitude === null || typeof i.latitude === 'number' && Number.isFinite(i.latitude) && Math.abs(i.latitude) <= 90)
    && (i.longitude === null || typeof i.longitude === 'number' && Number.isFinite(i.longitude) && Math.abs(i.longitude) <= 180);
}
function news(v: unknown, now: number): v is CyberNewsItem {
  if (!v || typeof v !== 'object') return false;
  const i = v as CyberNewsItem;
  return text(i.id,160) && text(i.title,500) && text(i.summary,2000) && text(i.publisher,200) && text(i.topic,80) && researchUrl(i.url) && stamp(i.publishedAt,now);
}
export function emptyResearchStore(): CyberResearchStore {
  return { version:1, captureEnabled:true, records:[], investigations:[], firstCaptureAt:null,lastCaptureAt:null,lastSourceFetchedAt:null };
}
function record(v: unknown, now: number): v is ResearchRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as ResearchRecord;
  return incident(r.incident,now) && stamp(r.firstSeenAt,now) && stamp(r.lastSeenAt,now) && r.lastSeenAt >= r.firstSeenAt
    && stamp(r.sourceFetchedAt,now) && Array.isArray(r.revisions) && r.revisions.length <= 5
    && r.revisions.every(c => c && stamp(c.at,now) && stamp(c.fetchedAt,now) && Array.isArray(c.fields) && c.fields.length <= fields.length && c.fields.every(f => Object.values(labels).includes(f)));
}
export function parseResearchStore(raw: string | null, now = Date.now()): CyberResearchStore | null {
  if (raw === null) return emptyResearchStore();
  if (raw.length > MAX_STORAGE_CHARS) return null;
  try {
    const s = JSON.parse(raw) as CyberResearchStore;
    if (!s || s.version !== 1 || typeof s.captureEnabled !== 'boolean' || !Array.isArray(s.records) || s.records.length > RESEARCH_LIMIT || !s.records.every(r=>record(r,now))
      || new Set(s.records.map(r=>r.incident.id)).size !== s.records.length
      || !Array.isArray(s.investigations) || s.investigations.length > INVESTIGATION_LIMIT
      || !s.investigations.every(c=>c && typeof c.id==='string' && /^[\w-]{1,80}$/.test(c.id) && text(c.title,120) && text(c.notes,4000) && stamp(c.savedAt,now) && stamp(c.updatedAt,now) && c.updatedAt >= c.savedAt && record(c.evidence,now) && Array.isArray(c.related) && c.related.length <= 5 && c.related.every(n=>news(n,now)) && (c.relatedFetchedAt===null || stamp(c.relatedFetchedAt,now)))
      || new Set(s.investigations.map(c=>c.id)).size !== s.investigations.length
      || ![s.firstCaptureAt,s.lastCaptureAt,s.lastSourceFetchedAt].every(v=>v===null || stamp(v,now))
      || (s.firstCaptureAt !== null && s.lastCaptureAt !== null && s.firstCaptureAt > s.lastCaptureAt)) return null;
    return s;
  } catch { return null; }
}
export function retainedResearch(s: CyberResearchStore, now = Date.now()): CyberResearchStore {
  return { ...s,records:s.records.filter(r=>now-r.lastSeenAt<RESEARCH_RETENTION) };
}
export function captureResearch(previous: CyberResearchStore, envelope: CyberEnvelope<CyberIncidentData>, now = Date.now()): CyberResearchStore {
  const s = structuredClone(retainedResearch(previous,now));
  if (!s.captureEnabled || envelope.dataset !== 'incidents' || envelope.status !== 'fresh' || !envelope.expiresAt || envelope.expiresAt <= now
    || !stamp(envelope.fetchedAt,now) || !envelope.data || !Array.isArray(envelope.data.items) || envelope.data.items.length > 20
    || !envelope.data.items.every(i=>incident(i,now))) return s;
  // Do not roll an archive back to an older cached provider response.
  if (s.lastSourceFetchedAt !== null && envelope.fetchedAt < s.lastSourceFetchedAt) return s;
  const records = new Map(s.records.map(r=>[r.incident.id,r]));
  for (const i of envelope.data.items) {
    const old = records.get(i.id);
    const changed = old ? fields.filter(f=>old.incident[f] !== i[f]).map(f=>labels[f]!) : [];
    records.set(i.id,{ incident:structuredClone(i),firstSeenAt:old?.firstSeenAt ?? now,lastSeenAt:now,sourceFetchedAt:envelope.fetchedAt,
      revisions:changed.length ? [...old!.revisions,{at:now,fetchedAt:envelope.fetchedAt,fields:changed}].slice(-5) : old?.revisions ?? [] });
  }
  s.records = [...records.values()].sort((a,b)=>b.lastSeenAt-a.lastSeenAt || a.incident.id.localeCompare(b.incident.id)).slice(0,RESEARCH_LIMIT);
  s.firstCaptureAt ??= now; s.lastCaptureAt = now;s.lastSourceFetchedAt = envelope.fetchedAt;
  return s;
}
export function filterResearch(records: ResearchRecord[], f: ResearchFilters, now = Date.now()): ResearchRecord[] {
  const q = f.query.trim().toLocaleLowerCase();
  return records.filter(({incident:i})=>(!f.country || i.countryCode===f.country) && (!f.sector || i.sector===f.sector)
    && (!f.days || i.reportedAt >= now - f.days*86400000)
    && (!q || `${i.organization} ${i.description} ${i.category} ${i.country} ${i.sector}`.toLocaleLowerCase().includes(q)))
    .sort((a,b)=>b.incident.reportedAt-a.incident.reportedAt || a.incident.id.localeCompare(b.incident.id));
}
export function researchGroups(records: ResearchRecord[], axis: 'country' | 'sector' | 'week'): [string,number][] {
  const counts = new Map<string,number>();
  for (const {incident:i} of records) {
    let key = axis === 'country' ? `${i.countryCode} · ${i.country || 'Unknown'}` : i.sector || 'Unknown';
    if (axis === 'week') {
      const d = new Date(i.reportedAt);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));key=d.toISOString().slice(0,10);
    }
    counts.set(key,(counts.get(key)||0)+1);
  }
  return [...counts].sort((a,b)=>axis==='week' ? b[0].localeCompare(a[0]) : b[1]-a[1] || a[0].localeCompare(b[0]));
}
export function relatedResearchNews(i: CyberIncident, items: CyberNewsItem[], now = Date.now()): CyberNewsItem[] {
  const name = i.organization.trim().toLocaleLowerCase();
  if (name.length < 4 || ['unknown','undisclosed','not disclosed','multiple organizations'].includes(name)) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,'iu');
  const unique = new Map<string,CyberNewsItem>();
  for (const n of items) if (news(n,now) && now-n.publishedAt<=7*86400000 && match.test(`${n.title} ${n.summary}`)) {
    const url = new URL(n.url);url.hash='';for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    if (!unique.has(url.href)) unique.set(url.href,n);
  }
  return [...unique.values()].sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,5);
}
export function saveResearchInvestigation(s: CyberResearchStore, evidence: ResearchRecord, related: CyberNewsItem[], id: string, now = Date.now(), relatedFetchedAt: number | null = null): CyberResearchStore {
  if (s.investigations.length >= INVESTIGATION_LIMIT) throw new Error('The 30-investigation limit is reached. Delete a saved investigation before saving another.');
  if (s.investigations.some(c=>c.evidence.incident.id===evidence.incident.id)) throw new Error('This incident already has a saved investigation.');
  return {...s,investigations:[{id,title:evidence.incident.organization.slice(0,120),notes:'',savedAt:now,updatedAt:now,evidence:structuredClone(evidence),related:structuredClone(related),relatedFetchedAt},...s.investigations]};
}
const coverage = 'UMD GoTech Cyber Events Database. Browser-observed public recent-record sample; monthly research updates. Not global incident totals, incidence rates, independently verified claims, or complete historical coverage. Local observations and provider dates are separate. Revision history lists changed fields, not full prior record copies.';
export function researchJson(c: CyberInvestigation, now = Date.now()): string {
  return JSON.stringify({format:'planetslam-cyber-investigation',version:1,exportedAt:now,coverage,privacy:'Contains your private notes. Export only to destinations you choose.',investigation:c},null,2);
}
export function researchCsv(records: ResearchRecord[]): string {
  const cell = (value: unknown) => {
    let s = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(s) || /^[\t\r\n]/u.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g,'""')}"`;
  };
  const header = ['record_id','organization','country_code','country','sector','category','claim_status','reported_at_utc','event_at_utc','first_observed_utc','last_observed_utc','provider_fetched_utc','database_url','reporting_url','description','coverage'];
  const iso = (n:number)=>new Date(n).toISOString();
  return '\uFEFF'+[header,...records.map(r=>{const i=r.incident;return [i.id,i.organization,i.countryCode,i.country,i.sector,i.category,i.verification,iso(i.reportedAt),iso(i.eventAt),iso(r.firstSeenAt),iso(r.lastSeenAt),iso(r.sourceFetchedAt),i.url,i.reportUrl,i.description,coverage];})].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function researchSerialized(s: CyberResearchStore): string {
  const raw=JSON.stringify(s);
  if (raw.length>MAX_STORAGE_CHARS || !parseResearchStore(raw)) throw new Error('Research data exceeds its storage limits or could not be validated. Existing saved data was retained.');
  return raw;
}
