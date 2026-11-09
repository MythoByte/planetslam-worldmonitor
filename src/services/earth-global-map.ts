import type { MapLayers } from '@/types';
import type { EarthMapSnapshot } from '@/types/earth-map';

export interface ExistingEarthMapItem { id?: string; webcamId?: string; url?: string; sourceUrl?: string; kind?: string }

function identityKeys(item: ExistingEarthMapItem): string[] {
  const keys: string[] = [];
  const id = item.id || item.webcamId;
  if (id) {
    let normalized = id.replace(/^(usgs|eonet|nws)[:-]/i, '');
    const gdacs = id.match(/^gdacs[:-]([a-z]{2})[:-](.+)$/i);
    if (gdacs) normalized = `gdacs:${gdacs[1]!.toUpperCase()}:${gdacs[2]}`;
    try {
      const url = new URL(normalized);
      if (url.hostname === 'api.weather.gov' && url.pathname.startsWith('/alerts/')) normalized = decodeURIComponent(url.pathname.slice('/alerts/'.length));
    } catch { /* Most provider IDs are not URLs. */ }
    keys.push(`id:${normalized}`);
  }
  for (const value of [item.url, item.sourceUrl]) {
    try {
      const url = new URL(value || '');
      if (item.kind === 'camera' || !/\/events?\/|eventpage|\/alerts\/|[?&]event(id)?=/i.test(url.href)) continue;
      url.hash = '';
      url.protocol = 'https:';
      keys.push(`url:${url.href}`);
    } catch { /* An absent source link is not an identity. */ }
  }
  return keys;
}

/** Reuse Global's layers and keep existing provider records as their single map representation. */
export function globalEarthMapSnapshot(
  snapshot: EarthMapSnapshot, layers: Pick<MapLayers, 'natural' | 'weather' | 'webcams' | 'fires'>,
  existing: readonly ExistingEarthMapItem[],
): EarthMapSnapshot {
  const seen = new Set(existing.flatMap(identityKeys));
  return { markers: snapshot.markers.filter(marker => {
    const layer = marker.kind === 'camera' ? 'webcams' : marker.hazard === 'wildfire' ? 'fires' : marker.sourceId?.startsWith('nws') || marker.hazard === 'weather' ? 'weather' : 'natural';
    if (!layers[layer]) return false;
    const keys = identityKeys(marker);
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  }) };
}
