import type { CommercialShippingBounds, CommercialShippingSnapshot } from '@/types/commercial-shipping';
import { freshCommercialVessels } from '@/types/commercial-shipping';
import { getRpcBaseUrl } from './rpc-client';

export async function fetchCommercialShipping(signal?: AbortSignal, bounds?: CommercialShippingBounds): Promise<CommercialShippingSnapshot> {
  const search = bounds ? `?${new URLSearchParams({ bbox: bounds.join(',') })}` : '';
  const response = await fetch(`${getRpcBaseUrl()}/api/commercial-shipping${search}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Commercial shipping unavailable');
  const data = await response.json();
  if (!Array.isArray(data.vessels) || typeof data.available !== 'boolean') throw new Error('Invalid commercial shipping response');
  let vessels = freshCommercialVessels(data.vessels);
  if (bounds) {
    const [south, west, north, east] = bounds;
    vessels = vessels.filter(v => v.lat >= south && v.lat <= north && v.lon >= west && v.lon <= east);
  }
  return { vessels, available: data.available, limited: data.limited === true };
}
