// Edge-safe evidence contract. AI selects IDs; it cannot write briefing facts or URLs.
export const CYBER_BRIEF_INPUTS = Object.freeze(['bleeping', 'krebs', 'hackernews', 'kev', 'incidents']);
export const CYBER_BRIEF_MAX_AGE_MS = 48 * 3600000;
const DAY = 86400000;
const states = new Set(['fresh', 'stale', 'unavailable']);
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const time = n => Number.isFinite(n) && n > 0 && Number.isFinite(new Date(n).getTime());
const optional = n => n === null || time(n);
const unique = values => new Set(values).size === values.length;
const url = v => { try { const u = new URL(v); return text(v, 4096) && u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
export function validCyberBrief(d) {
  if (!d || !time(d.generatedAt) || d.date !== new Date(d.generatedAt).toISOString().slice(0, 10)
    || d.periodEnd !== Date.parse(d.date + 'T00:00:00Z') || d.periodStart !== d.periodEnd - DAY
    || !['ai-curated', 'source-summary'].includes(d.mode) || (d.mode === 'ai-curated' ? !text(d.model, 120) : d.model !== null)
    || !['curated', 'not-configured', 'failed', 'rejected', 'admission-used'].includes(d.aiStatus)
    || (d.mode === 'ai-curated') !== (d.aiStatus === 'curated')
    || !Array.isArray(d.candidates) || !d.candidates.length || d.candidates.length > 30
    || !Array.isArray(d.items) || !d.items.length || d.items.length > 8
    || !Array.isArray(d.coverage) || d.coverage.length !== CYBER_BRIEF_INPUTS.length) return false;
  if (!d.candidates.every(c => c && /^e\d{1,2}$/.test(c.id) && ['news', 'kev', 'research'].includes(c.kind)
    && CYBER_BRIEF_INPUTS.includes(c.dataset) && text(c.title, 300) && text(c.publisher, 120) && url(c.url)
    && time(c.publishedAt) && c.publishedAt <= d.generatedAt + 60000
    && (c.kind === 'research' || c.publishedAt >= d.periodStart && c.publishedAt < d.periodEnd)
    && (c.kind === 'kev' ? c.dataset === 'kev' : c.kind === 'research' ? c.dataset === 'incidents' : ['bleeping', 'krebs', 'hackernews'].includes(c.dataset))
    && time(c.fetchedAt) && c.fetchedAt <= d.generatedAt + 60000 && time(c.expiresAt) && c.expiresAt > d.generatedAt
    && time(c.freshUntil) && c.freshUntil <= c.expiresAt && states.has(c.status) && c.status !== 'unavailable'
    && Array.isArray(c.facts) && c.facts.length > 0 && c.facts.length <= 3
    && c.facts.every(f => f && /^f[1-3]$/.test(f.id) && text(f.text, 1000)) && unique(c.facts.map(f => f.id)))) return false;
  if (!unique(d.candidates.map(c => c.id))) return false;
  if (!d.items.every(i => i && text(i.id, 3) && Array.isArray(i.factIds) && i.factIds.length > 0 && i.factIds.length <= 3
    && unique(i.factIds) && i.factIds.every(id => d.candidates.find(c => c.id === i.id)?.facts.some(f => f.id === id)))) return false;
  if (!unique(d.items.map(i => i.id)) || !d.items.some(i => d.candidates.find(c => c.id === i.id)?.kind !== 'research')) return false;
  const selectedKinds = d.items.map(i => d.candidates.find(c => c.id === i.id).kind);
  if (['news', 'kev'].some(k => d.candidates.some(c => c.kind === k) && !selectedKinds.includes(k))
    || selectedKinds.filter(k => k === 'news').length > 4 || selectedKinds.filter(k => k === 'kev').length > 3 || selectedKinds.filter(k => k === 'research').length > 1) return false;
  return d.coverage.every(c => c && CYBER_BRIEF_INPUTS.includes(c.dataset) && states.has(c.status)
    && optional(c.fetchedAt) && optional(c.observedAt) && optional(c.expiresAt) && optional(c.freshUntil)
    && (c.fetchedAt === null || c.fetchedAt <= d.generatedAt + 60000)
    && (c.observedAt === null || c.observedAt <= d.generatedAt + 60000)
    && Number.isInteger(c.itemCount) && c.itemCount >= 0 && c.itemCount <= 10000
    && Number.isInteger(c.selectedCount) && c.selectedCount >= 0 && c.selectedCount <= 30
    && (c.status === 'unavailable' ? c.selectedCount === 0 : time(c.fetchedAt) && time(c.expiresAt) && time(c.freshUntil)))
    && unique(d.coverage.map(c => c.dataset));
}
export function projectCyberBrief(snapshot, now = Date.now()) {
  const d = snapshot?.data;
  const valid = snapshot?.dataset === 'brief' && validCyberBrief(d) && time(snapshot.fetchedAt)
    && snapshot.fetchedAt <= now + 60000 && d.generatedAt <= now + 60000 && snapshot.fetchedAt >= d.generatedAt - 60000;
  const expiresAt = valid ? d.generatedAt + CYBER_BRIEF_MAX_AGE_MS : null;
  if (!valid || now >= expiresAt) return { status: 'unavailable', fetchedAt: valid ? snapshot.fetchedAt : null,
    observedAt: valid ? d.generatedAt : null, expiresAt, data: null, message: 'Daily brief unavailable. Usable cached reporting is required; this is not evidence of a quiet day.' };
  const status = d.date === new Date(now).toISOString().slice(0, 10) ? 'fresh' : 'stale';
  const age = c => ({ ...c, status: c.status === 'unavailable' || now >= c.expiresAt ? 'unavailable' : c.status === 'stale' || now >= c.freshUntil ? 'stale' : 'fresh' });
  return { status, fetchedAt: snapshot.fetchedAt, observedAt: d.generatedAt, expiresAt,
    message: status === 'stale' ? 'Previous UTC day brief. Evidence and reporting window retain their original dates.' : '',
    data: { ...d, candidates: d.candidates.map(age), coverage: d.coverage.map(age) } };
}
