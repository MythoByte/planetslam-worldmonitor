const PRECISIONS = new Set(['second', 'minute', 'hour', 'day', 'month', 'quarter', 'year', 'unknown']);
const KINDS = new Set(['spacewalk', 'docking', 'landing', 'briefing', 'other']);
const COARSE_PRECISIONS = new Set(['day', 'month', 'quarter', 'year']);
export const missionIsTerminal = item => /cancel(?:led|ed)?|complete(?:d)?|success|fail|terminated/i.test(item.status || '')
  || /^\s*(?:cancelled|canceled|completed)\b/i.test(item.name || '');

const boundedText = (value, max = 2000) => typeof value === 'string' && value.length <= max;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime());
const optionalTimestamp = value => value === null || timestamp(value);
function safeHttpsUrl(value, optional = false) {
  if (!boundedText(value, 4096)) return false;
  if (optional && value === '') return true;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; }
}

export function validMissionData(data) {
  return data && Array.isArray(data.items) && data.items.length <= 30 && Number.isInteger(data.totalCount) && data.totalCount >= data.items.length
    && typeof data.truncated === 'boolean' && data.items.every(item => item && !Array.isArray(item) && validId(item.id)
      && boundedText(item.name) && item.name.length > 0 && boundedText(item.type) && item.type.length > 0
      && boundedText(item.description, 6000) && boundedText(item.location) && boundedText(item.datePrecisionDescription)
      && timestamp(item.date) && PRECISIONS.has(item.datePrecision) && KINDS.has(item.kind)
      && boundedText(item.status) && item.status.length > 0 && safeHttpsUrl(item.url) && safeHttpsUrl(item.webcastUrl, true)
      && optionalTimestamp(item.windowStart) && optionalTimestamp(item.windowEnd) && optionalTimestamp(item.updatedAt)
      && (item.windowStart === null || item.windowEnd === null || item.windowEnd >= item.windowStart)
      && (item.durationSeconds === null || (typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds) && item.durationSeconds >= 0 && item.durationSeconds <= 7 * 86400))
      && Array.isArray(item.launchIds) && item.launchIds.length <= 100 && item.launchIds.every(validId));
}

/** Reassess current schedules on every cache read without touching provider clocks. */
export function missionPrecisionPeriodEnd(item) {
  if (!Number.isFinite(item.date)) return null;
  const at = new Date(item.date);
  if (!Number.isFinite(at.getTime())) return null;
  const year = at.getUTCFullYear(), month = at.getUTCMonth(), day = at.getUTCDate();
  // These are exclusive retention boundaries, not exact event times/windows.
  switch (item.datePrecision) {
    case 'day': return Date.UTC(year, month, day + 1);
    case 'month': return Date.UTC(year, month + 1, 1);
    case 'quarter': return Date.UTC(year, Math.floor(month / 3) * 3 + 3, 1);
    case 'year': return Date.UTC(year + 1, 0, 1);
    default: return item.date;
  }
}

export function missionStillUpcoming(item, now = Date.now()) {
  const end = missionPrecisionPeriodEnd(item);
  return end !== null && !missionIsTerminal(item)
    && (COARSE_PRECISIONS.has(item.datePrecision) ? end > now : end >= now);
}

export function upcomingMissionItems(items, now = Date.now()) {
  return items.filter(item => missionStillUpcoming(item, now))
    .sort((a, b) => a.date - b.date);
}
