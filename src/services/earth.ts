import { getRpcBaseUrl } from './rpc-client';
import { EARTH_SELECT_EVENT } from '@/types/earth';
export type { EarthSelection } from '@/types/earth';
import type { EarthHistoryData, EarthHistoryFrame, EarthSource, EarthSelection, EarthDataset, EarthEnvelope, EarthEvent, EarthEventFilter, EarthNewsItem, EarthWeatherItem, EarthWeatherPoint } from '@/types/earth';

const cache = new Map<EarthDataset, { at: number; value: EarthEnvelope<unknown> }>();
let selectedEarthEventId = '';
let earthSelection: EarthSelection | null = null;
export const getEarthSelection = (): EarthSelection | null => earthSelection;
export function publishEarthSelection(detail: EarthSelection): void {
  earthSelection = { ...detail };
  if (detail.kind === 'event') selectedEarthEventId = detail.id;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EARTH_SELECT_EVENT, { detail: earthSelection }));
}
export const getSelectedEarthEventId = (): string => selectedEarthEventId;
export const setSelectedEarthEventId = (id: string): void => { selectedEarthEventId = id; };

const pending = new Map<EarthDataset, Promise<EarthEnvelope<unknown>>>();

/** Age an already fetched envelope before any consumer displays it again. */
export function ageEarthEnvelope<T>(envelope: EarthEnvelope<T>, now = Date.now()): EarthEnvelope<T> {
  // Historical events keep the warning expiry and source state recorded at that time.
  // Only the archive envelope itself ages against the current clock.
  if (envelope.dataset === 'history') {
    const data = envelope.data as EarthHistoryData | null;
    const expired = envelope.expiresAt !== null && now >= envelope.expiresAt;
    const delayed = envelope.fetchedAt !== null && now - envelope.fetchedAt >= 2 * 3600_000;
    return { ...envelope, status: expired ? 'unavailable' : delayed && envelope.status === 'fresh' ? 'stale' : envelope.status,
      data: expired || envelope.status === 'unavailable' ? null : data ? { ...data, items: data.items.filter(frame => frame.recordedAt >= now - 7 * 86400_000 && frame.recordedAt <= now + 60_000) } as T : null };
  }
  if (envelope.dataset === 'health' && envelope.data && typeof envelope.data === 'object' && 'items' in envelope.data) {
    const data = envelope.data as { items: EarthEnvelope<unknown>[] };
    const items = data.items.map(item => ageEarthEnvelope(item, now));
    const status = items.every(item => item.status === 'fresh') ? 'fresh'
      : items.every(item => item.status === 'unavailable') ? 'unavailable' : 'stale';
    return { ...envelope, status, data: { ...data, items } as T };
  }
  const dataSources = envelope.data && typeof envelope.data === 'object' && 'sources' in envelope.data
    ? (envelope.data as { sources?: EarthSource[] }).sources : undefined;
  const sources = (envelope.sources || dataSources)?.map(item => item.expiresAt != null && now >= item.expiresAt
    ? { ...item, status: 'unavailable' as const, message: 'The source snapshot has expired.' }
    : item.status === 'fresh' && item.staleAt != null && now > item.staleAt
      ? { ...item, status: 'stale' as const, message: 'Source refresh delayed; last known data.' } : item);
  if (sources?.length) {
    const available = sources.filter(item => item.status !== 'unavailable');
    const status = !available.length || envelope.status === 'unavailable' ? 'unavailable'
      : sources.every(item => item.status === 'fresh') ? 'fresh' : 'stale';
    const ids = new Set(available.map(item => item.id));
    const byId = new Map(available.map(item => [item.id, item]));
    const raw = envelope.data && typeof envelope.data === 'object' && 'items' in envelope.data
      ? envelope.data as { items: { sourceId: string; expiresAt?: number | null; observedAt?: number }[] } : null;
    const items = raw?.items.filter(item => {
      const maxAge = byId.get(item.sourceId)?.observationMaxAgeMs;
      return ids.has(item.sourceId) && (item.expiresAt == null || item.expiresAt > now)
        && (maxAge == null || envelope.dataset === 'weather' || typeof item.observedAt === 'number' && now - item.observedAt < maxAge)
        && (envelope.dataset !== 'earthquakes' || typeof item.observedAt === 'number' && now - item.observedAt <= 86400_000);
    });
    const times = available.map(item => item.expiresAt).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return { ...envelope, sources, status, expiresAt: times.length ? Math.min(...times) : null,
      ...(status === 'unavailable' ? { message: 'The last shared snapshots are unavailable or expired. Retry for a current update.' }
        : status === 'stale' ? { message: 'Some sources are delayed or unavailable; inspect source status.' } : {}),
      data: status === 'unavailable' ? null : raw ? { ...raw, items, sources } as T : envelope.data };
  }
  const metadata = sources ? { ...envelope, sources } : envelope;
  if (envelope.status === 'unavailable') return { ...metadata, data: null };
  if (envelope.expiresAt !== null && (!Number.isFinite(envelope.expiresAt) || now >= envelope.expiresAt)) {
    return { ...metadata, status: 'unavailable', data: null, message: 'The last shared snapshot has expired. Retry for a current update.' };
  }
  return metadata;
}

/** Shared, deduplicated requests. This endpoint only reads centrally seeded data. */
export async function fetchEarthDataset<T>(dataset: EarthDataset, force = false): Promise<EarthEnvelope<T>> {
  const hit = cache.get(dataset);
  if (!force && hit && Date.now() - hit.at < 60_000) return ageEarthEnvelope(hit.value) as EarthEnvelope<T>;
  let request = pending.get(dataset);
  if (!request) {
    request = (async () => {
      const response = await fetch(`${getRpcBaseUrl()}/api/earth?dataset=${encodeURIComponent(dataset)}`, {
        signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Earth data temporarily unavailable');
      const value = await response.json() as EarthEnvelope<unknown>;
      if (value.dataset !== dataset || !['fresh', 'stale', 'unavailable'].includes(value.status)
        || typeof value.provider !== 'string' || typeof value.coverage !== 'string'
        || !('expiresAt' in value) || !('data' in value)
        || (value.data !== null && (typeof value.data !== 'object' || !Array.isArray((value.data as { items?: unknown }).items)))) {
        throw new Error('Invalid Earth data response');
      }
      if (dataset === 'history' && value.data !== null) {
        const history = value.data as EarthHistoryData;
        if (!Array.isArray(history.events) || !history.items.every(frame => Number.isFinite(frame.recordedAt) && Array.isArray(frame.eventKeys) && Array.isArray(frame.sources))) throw new Error('Invalid Earth history response');
      }
      cache.set(dataset, { at: Date.now(), value });
      return value;
    })().catch(error => { cache.delete(dataset); throw error; }).finally(() => pending.delete(dataset));
    pending.set(dataset, request);
  }
  return ageEarthEnvelope(await request) as EarthEnvelope<T>;
}

export function filterEarthEvents(items: EarthEvent[], filter: EarthEventFilter = {}, now = Date.now()): EarthEvent[] {
  return items.filter(item => (item.expiresAt === null || item.expiresAt > now)
    && (!filter.hazard || filter.hazard === 'all' || (item.kind === filter.hazard || item.hazards?.includes(filter.hazard as EarthEvent['kind'])))
    && (!filter.region || filter.region === 'all' || item.region === filter.region)
    && (!filter.severity || filter.severity === 'all' || item.severity === filter.severity)
    && (!filter.hours || item.observedAt >= now - filter.hours * 3600_000))
    .sort((a, b) => b.observedAt - a.observedAt);
}

/** Exact source references first; category plus named region is explicitly contextual. */
export function relatedEarthNews(event: EarthEvent, news: EarthNewsItem[]): { item: EarthNewsItem; exact: boolean }[] {
  return news.flatMap(item => {
    const exact = item.url === event.url || (item.relatedUrls || []).includes(event.url);
    const contextual = event.region !== 'Global' && event.region !== 'Unknown' && event.region.trim() !== ''
      && item.region === event.region && item.kind === event.kind;
    return exact || contextual ? [{ item, exact }] : [];
  }).sort((a, b) => Number(b.exact) - Number(a.exact) || b.item.publishedAt - a.item.publishedAt).slice(0, 5);
}


/** Advance through the model timeline as a snapshot ages; never label its first old hour as current. */
export function currentEarthWeather(item: EarthWeatherItem, now = Date.now()): { current: EarthWeatherPoint | null; forecast: EarthWeatherPoint[] } {
  const points = item.forecast.filter(point => Number.isFinite(point.time)).slice().sort((a, b) => a.time - b.time);
  const preceding = points.filter(point => point.time <= now && now - point.time < 3600_000);
  const current = preceding[preceding.length - 1] || points.find(point => point.time > now && point.time - now < 3600_000) || null;
  return { current, forecast: points.filter(point => point.time >= now) };
}

/** Resolve only revisions actually retained in the selected historical snapshot. */
export function earthHistoryEvents(data: EarthHistoryData, frame: EarthHistoryFrame): EarthEvent[] {
  const records = new Map(data.events.map(record => [record.key, record.event]));
  return frame.eventKeys.flatMap(key => { const event = records.get(key); return event ? [event] : []; });
}
