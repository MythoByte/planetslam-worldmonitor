import { getRpcBaseUrl } from './rpc-client';
import type { SpaceDataset, SpaceEnvelope } from '@/types/space';

const cache = new Map<SpaceDataset, { at: number; value: SpaceEnvelope<unknown> }>();
const pending = new Map<SpaceDataset, Promise<SpaceEnvelope<unknown>>>();

/** Deduplicate shared panels; this endpoint only reads centrally ingested data. */
export async function fetchSpaceDataset<T>(dataset: SpaceDataset, force = false): Promise<SpaceEnvelope<T>> {
  const hit = cache.get(dataset);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.value as SpaceEnvelope<T>;
  let request = pending.get(dataset);
  if (!request) {
    request = (async () => {
      const response = await fetch(`${getRpcBaseUrl()}/api/space?dataset=${encodeURIComponent(dataset)}`, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Space data temporarily unavailable');
      const value = await response.json() as SpaceEnvelope<unknown>;
      if (value.dataset !== dataset || !['fresh', 'stale', 'unavailable'].includes(value.status)
        || typeof value.provider !== 'string' || !('data' in value)) throw new Error('Invalid Space data response');
      cache.set(dataset, { at: Date.now(), value });
      return value;
    })().finally(() => pending.delete(dataset));
    pending.set(dataset, request);
  }
  return await request as SpaceEnvelope<T>;
}
