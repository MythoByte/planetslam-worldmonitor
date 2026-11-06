import { getRpcBaseUrl } from './rpc-client';
import type { CyberDataset, CyberEnvelope } from '@/types/cyber-dashboard';
const cache = new Map<CyberDataset, { at: number; value: CyberEnvelope }>();
const pending = new Map<CyberDataset, Promise<CyberEnvelope>>();
export async function fetchCyberDataset<T>(dataset: CyberDataset, force = false): Promise<CyberEnvelope<T>> {
  const hit = cache.get(dataset);
  if (!force && hit && Date.now() - hit.at < 30_000) return hit.value as CyberEnvelope<T>;
  let request = pending.get(dataset);
  if (!request) {
    request = (async () => {
      const response = await fetch(`${getRpcBaseUrl()}/api/cyber-dashboard?dataset=${dataset}`, {
        signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Cyber data temporarily unavailable');
      const value = await response.json() as CyberEnvelope;
      if (value.dataset !== dataset || !['fresh', 'stale', 'unavailable'].includes(value.status)
        || typeof value.provider !== 'string' || !('data' in value)) throw new Error('Invalid cyber response');
      cache.set(dataset, { at: Date.now(), value }); return value;
    })().finally(() => pending.delete(dataset));
    pending.set(dataset, request);
  }
  return await request as CyberEnvelope<T>;
}
