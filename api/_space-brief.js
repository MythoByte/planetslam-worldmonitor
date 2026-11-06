// Edge-safe daily briefing contract. A brief is a dated source snapshot, not live telemetry.
export const SPACE_BRIEF_INPUTS = Object.freeze(['apod', 'news', 'launches', 'weather', 'aurora', 'solar', 'events', 'neo', 'orbits', 'missions']);
export const SPACE_BRIEF_MAX_AGE_MS = 48 * 3600_000;
const STATES = new Set(['fresh', 'stale', 'unavailable']);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime());
const optionalTime = value => value === null || timestamp(value);
const dataset = value => SPACE_BRIEF_INPUTS.includes(value);
const safeUrl = value => {
  if (!text(value, 4096)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};
const unique = values => new Set(values).size === values.length;

export function validSpaceBrief(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !timestamp(data.generatedAt)
    || data.date !== new Date(data.generatedAt).toISOString().slice(0, 10) || !text(data.title, 160)
    || !['ai', 'source-summary'].includes(data.mode) || (data.mode === 'ai' ? !text(data.model, 120) : data.model !== null)
    || !Array.isArray(data.sources) || data.sources.length < 1 || data.sources.length > 24
    || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 10
    || !Array.isArray(data.coverage) || data.coverage.length !== SPACE_BRIEF_INPUTS.length
    || !Array.isArray(data.limitations) || data.limitations.length > 8 || !data.limitations.every(value => text(value, 500))) return false;
  if (!data.sources.every(source => source && /^s\d{1,2}$/.test(source.id) && dataset(source.dataset) && text(source.title, 300)
    && safeUrl(source.url) && timestamp(source.fetchedAt) && source.fetchedAt <= data.generatedAt + 60_000
    && optionalTime(source.observedAt) && (source.observedAt === null || source.observedAt <= data.generatedAt + 60_000)
    && timestamp(source.expiresAt) && source.expiresAt >= source.fetchedAt && source.expiresAt <= source.fetchedAt + SPACE_BRIEF_MAX_AGE_MS
    && timestamp(source.freshUntil) && source.freshUntil >= source.fetchedAt
    && source.freshUntil <= source.expiresAt && ['fresh', 'stale'].includes(source.status))) return false;
  if (!unique(data.sources.map(source => source.id))) return false;
  const ids = new Set(data.sources.map(source => source.id));
  if (!data.items.every(item => item && /^brief-\d{1,2}$/.test(item.id) && text(item.heading, 120) && text(item.summary, 2000)
    && Array.isArray(item.sourceIds) && item.sourceIds.length > 0 && item.sourceIds.length <= 8 && unique(item.sourceIds)
    && item.sourceIds.every(id => ids.has(id)))) return false;
  if (!unique(data.items.map(item => item.id))) return false;
  return data.coverage.every(row => row && dataset(row.dataset) && STATES.has(row.status)
    && optionalTime(row.fetchedAt) && optionalTime(row.observedAt) && optionalTime(row.expiresAt) && optionalTime(row.freshUntil)
    && (row.fetchedAt === null || row.fetchedAt <= data.generatedAt + 60_000)
    && (row.observedAt === null || row.observedAt <= data.generatedAt + 60_000)
    && (row.status === 'unavailable' || (timestamp(row.fetchedAt) && timestamp(row.freshUntil) && timestamp(row.expiresAt)
      && row.freshUntil >= row.fetchedAt && row.expiresAt >= row.freshUntil && row.expiresAt <= row.fetchedAt + SPACE_BRIEF_MAX_AGE_MS))
    && Number.isInteger(row.itemCount) && row.itemCount >= 0 && row.itemCount <= 100_000)
    && unique(data.coverage.map(row => row.dataset));
}

export function projectSpaceBrief(snapshot, now = Date.now()) {
  const data = snapshot?.data;
  const fetchedAt = snapshot?.fetchedAt;
  const valid = snapshot?.dataset === 'brief' && validSpaceBrief(data) && timestamp(fetchedAt)
    && fetchedAt <= now + 60_000 && data.generatedAt <= now + 60_000 && fetchedAt >= data.generatedAt - 60_000;
  const expired = !valid || now - data.generatedAt > SPACE_BRIEF_MAX_AGE_MS;
  if (expired) return { status: 'unavailable', fetchedAt: valid ? fetchedAt : null, observedAt: valid ? data.generatedAt : null,
    expiresAt: valid ? data.generatedAt + SPACE_BRIEF_MAX_AGE_MS : null, data: null,
    message: 'Daily brief unavailable. The worker needs usable Space source snapshots; this is not a quiet-space assessment.' };
  const date = new Date(now).toISOString().slice(0, 10);
  const status = data.date === date ? 'fresh' : 'stale';
  return { status, fetchedAt, observedAt: data.generatedAt, expiresAt: data.generatedAt + SPACE_BRIEF_MAX_AGE_MS,
    data: { ...data,
      sources: data.sources.map(source => ({ ...source, status: source.status === 'stale' || now > source.freshUntil ? 'stale' : 'fresh' })),
      coverage: data.coverage.map(row => ({ ...row, status: row.status === 'unavailable' || (row.expiresAt !== null && now > row.expiresAt) ? 'unavailable'
        : row.status === 'stale' || (row.freshUntil !== null && now > row.freshUntil) ? 'stale' : 'fresh' })),
    }, ...(status === 'stale' ? { message: 'Previous UTC day brief; read the original snapshot time and source coverage.' } : {}) };
}
