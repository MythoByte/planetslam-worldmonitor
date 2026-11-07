import { EARTH_SOURCES, projectEarthSource, validEarthData } from './_earth-data.js';

export const EARTH_HISTORY_KEY = 'earth:history:v1';
export const EARTH_HISTORY_INTERVAL_MS = 60 * 60_000;
export const EARTH_HISTORY_RETENTION_MS = 7 * 24 * EARTH_HISTORY_INTERVAL_MS;
export const EARTH_HISTORY_MAX_FRAMES = 168;
export const EARTH_HISTORY_MAX_EVENTS = 500;
export const EARTH_HISTORY_MAX_RECORDS = 4000;
export const EARTH_HISTORY_MAX_BYTES = 2 * 1024 * 1024;
export const EARTH_HISTORY_SOURCE_IDS = Object.keys(EARTH_SOURCES).filter(id => ['earthquakes', 'events', 'alerts'].includes(EARTH_SOURCES[id].dataset));
const coverage = 'Recorded hourly snapshots of available Earth event feeds, retained for up to 7 days. Maximum 168 frames, 500 events per frame and 2 MiB total; capacity limits can shorten retained history. Recording begins when the worker is enabled. Gaps are not reconstructed. Historical warnings are not current alerts.';
const time = value => Number.isFinite(value) && value > 0 && value <= 8_640_000_000_000_000;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const severities = ['extreme', 'severe', 'moderate', 'minor', 'unknown'];

function validSources(sources, recordedAt) {
  return Array.isArray(sources) && sources.length === EARTH_HISTORY_SOURCE_IDS.length
    && new Set(sources.map(source => source?.id)).size === sources.length
    && sources.every(source => EARTH_HISTORY_SOURCE_IDS.includes(source?.id)
      && ['fresh', 'stale', 'unavailable'].includes(source.status)
      && typeof source.coverage === 'string' && source.coverage.length <= 5000
      && typeof source.provider === 'string' && source.provider.length <= 200
      && (source.fetchedAt === null || time(source.fetchedAt) && source.fetchedAt <= recordedAt + 60_000)
      && (source.observedAt === null || time(source.observedAt))
      && (source.status === 'unavailable' || time(source.fetchedAt)));
}

/** Validate references before allowing historic records to bypass current-alert expiry. */
export function validEarthHistory(raw, now = Date.now()) {
  if (!raw || raw.version !== 1 || !time(raw.fetchedAt) || raw.fetchedAt > now + 60_000
    || !Number.isSafeInteger(raw.nextRecordId) || raw.nextRecordId < 1
    || !Array.isArray(raw.items) || !raw.items.length || raw.items.length > EARTH_HISTORY_MAX_FRAMES
    || !Array.isArray(raw.events) || raw.events.length > EARTH_HISTORY_MAX_RECORDS || bytes(raw) > EARTH_HISTORY_MAX_BYTES) return false;
  const records = new Map();
  for (const record of raw.events) {
    if (!record || !/^r[1-9]\d*$/.test(record.key) || record.key.length > 20 || records.has(record.key)
      || !EARTH_HISTORY_SOURCE_IDS.includes(record.event?.sourceId)
      || !validEarthData(record.event.sourceId, { items: [record.event] })) return false;
    records.set(record.key, record.event);
  }
  let previous = 0;
  for (const frame of raw.items) {
    if (!frame || !time(frame.recordedAt) || frame.recordedAt <= previous || frame.recordedAt > now + 60_000
      || frame.recordedAt > raw.fetchedAt || !validSources(frame.sources, frame.recordedAt)
      || !Array.isArray(frame.eventKeys) || frame.eventKeys.length > EARTH_HISTORY_MAX_EVENTS
      || new Set(frame.eventKeys).size !== frame.eventKeys.length
      || !Number.isSafeInteger(frame.totalEvents) || frame.totalEvents < frame.eventKeys.length || frame.totalEvents > 2500 * EARTH_HISTORY_SOURCE_IDS.length
      || frame.truncated !== (frame.totalEvents > frame.eventKeys.length)
      || frame.eventKeys.some(key => {
        const event = records.get(key);
        return !event || !frame.sources.some(source => source.id === event.sourceId && source.status !== 'unavailable')
          || event.observedAt > frame.recordedAt + 60_000
          || event.expiresAt !== null && event.expiresAt <= frame.recordedAt;
      })) return false;
    previous = frame.recordedAt;
  }
  return previous === raw.fetchedAt;
}

function pruneRecords(archive) {
  const used = new Set(archive.items.flatMap(frame => frame.eventKeys));
  archive.events = archive.events.filter(record => used.has(record.key));
}

/** Capture only the data actually available now, never synthesize frames for missed hours. */
export function appendEarthHistory(previous, snapshots, now = Date.now()) {
  if (previous !== null && previous !== undefined && !validEarthHistory(previous, now)) throw new Error('Invalid previous Earth archive');
  if (previous && now - previous.fetchedAt < EARTH_HISTORY_INTERVAL_MS) return null;
  const sources = EARTH_HISTORY_SOURCE_IDS.map(id => {
    const source = projectEarthSource(id, snapshots[id], now);
    // Legacy snapshots may contain future observations or already expired events.
    // Omit those records per source instead of preventing healthy peers' capture.
    const items = source.items.filter(event => event.observedAt <= now + 60_000
      && (event.expiresAt === null || event.expiresAt > now));
    const omitted = source.items.length - items.length;
    return omitted ? { ...source, items, status: items.length ? 'stale' : 'unavailable',
      message: `${omitted} event records omitted from history because their timestamps do not describe conditions at capture time.` } : source;
  });
  if (sources.every(source => source.status === 'unavailable')) return null;
  const events = sources.flatMap(source => source.items).sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity) || b.observedAt - a.observedAt || a.id.localeCompare(b.id));
  const archive = previous ? structuredClone(previous) : { version: 1, fetchedAt: now, nextRecordId: 1, items: [], events: [] };
  archive.items = archive.items.filter(frame => frame.recordedAt > now - EARTH_HISTORY_RETENTION_MS);
  pruneRecords(archive);
  const revisions = new Map(archive.events.map(record => [JSON.stringify(record.event), record.key]));
  const eventKeys = events.slice(0, EARTH_HISTORY_MAX_EVENTS).map(event => {
    const content = JSON.stringify(event);
    let key = revisions.get(content);
    if (!key) {
      key = `r${archive.nextRecordId++}`;
      archive.events.push({ key, event }); revisions.set(content, key);
    }
    return key;
  });
  archive.items.push({ recordedAt: now, sources: sources.map(({ items: _items, ...metadata }) => metadata), eventKeys,
    totalEvents: events.length, truncated: events.length > eventKeys.length });
  archive.fetchedAt = now;
  while (archive.items.length > EARTH_HISTORY_MAX_FRAMES) archive.items.shift();
  pruneRecords(archive);
  while (archive.items.length > 1 && (archive.events.length > EARTH_HISTORY_MAX_RECORDS || bytes(archive) > EARTH_HISTORY_MAX_BYTES - 2048)) {
    archive.items.shift(); pruneRecords(archive);
  }
  // A single unusually large frame is explicitly truncated rather than exceed the wire bound.
  const frame = archive.items.at(-1);
  while (frame.eventKeys.length && bytes(archive) > EARTH_HISTORY_MAX_BYTES - 2048) {
    frame.eventKeys.pop(); frame.truncated = true; pruneRecords(archive);
  }
  if (!validEarthHistory(archive, now)) throw new Error('Invalid Earth archive');
  return archive;
}

export function earthHistoryEnvelope(raw, now = Date.now()) {
  const valid = validEarthHistory(raw, now);
  const frames = valid ? raw.items.filter(frame => frame.recordedAt > now - EARTH_HISTORY_RETENTION_MS) : [];
  const fetchedAt = valid ? raw.fetchedAt : null;
  const status = !frames.length ? 'unavailable' : now - fetchedAt >= 2 * EARTH_HISTORY_INTERVAL_MS ? 'stale' : 'fresh';
  const used = new Set(frames.flatMap(frame => frame.eventKeys));
  return { dataset: 'history', status, provider: 'PlanetSlam Earth recorded history', sourceUrl: 'https://planetslam.com/dashboard?variant=earth', coverage,
    fetchedAt, observedAt: null, expiresAt: frames.length ? fetchedAt + EARTH_HISTORY_RETENTION_MS : null,
    ...(status === 'unavailable' ? { message: 'No recorded history is available yet. Recording starts when the Earth worker is enabled.' }
      : status === 'stale' ? { message: 'History recording is delayed. These are historical snapshots, not current conditions.' } : {}),
    data: { items: frames, events: valid ? raw.events.filter(record => used.has(record.key)) : [] } };
}
