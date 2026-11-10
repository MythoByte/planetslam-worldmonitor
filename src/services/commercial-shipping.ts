import type { CommercialShippingSnapshot } from '@/types/commercial-shipping';
import { freshCommercialVessels } from '@/types/commercial-shipping';
import { getRpcBaseUrl } from './rpc-client';

export async function fetchCommercialShipping(signal?: AbortSignal): Promise<CommercialShippingSnapshot> {
  const response = await fetch(`${getRpcBaseUrl()}/api/commercial-shipping`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Commercial shipping unavailable');
  const data = await response.json();
  if (!Array.isArray(data.vessels) || typeof data.available !== 'boolean') throw new Error('Invalid commercial shipping response');
  return { vessels: freshCommercialVessels(data.vessels), available: data.available, limited: data.limited === true };
}
