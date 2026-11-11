import { CHOKEPOINT_REGISTRY } from '@/config/chokepoint-registry';
import { PORTS } from '@/config/ports';
import type { CommercialShippingBounds } from '@/types/commercial-shipping';
import { getCountryBbox, getCountryNameByCode, iso3ToIso2Code, nameToCountryCode, preloadCountryGeometry } from './country-geometry';

export interface CommercialShippingArea {
  name: string;
  bounds: CommercialShippingBounds;
}

export const SHIPPING_AREAS: CommercialShippingArea[] = [
  ...CHOKEPOINT_REGISTRY.map(({ displayName, lat, lon }): CommercialShippingArea => ({
    name: displayName, bounds: [lat - 2, lon - 2, lat + 2, lon + 2],
  })),
  { name: 'Persian Gulf', bounds: [23.5, 47.5, 31, 57] },
  { name: 'Gulf of Oman', bounds: [22, 56, 27, 62] },
  { name: 'Red Sea', bounds: [12, 32, 30.5, 44] },
  { name: 'Gulf of Aden', bounds: [10.5, 42.5, 16, 52] },
  { name: 'Black Sea', bounds: [40, 27, 47.5, 42.5] },
  { name: 'South China Sea', bounds: [0, 99, 25, 122] },
  ...PORTS.map(({ name, lat, lon }): CommercialShippingArea => ({
    name, bounds: [lat - 1, lon - 1, lat + 1, lon + 1],
  })),
];

export async function findCommercialShippingArea(query: string): Promise<CommercialShippingArea | undefined> {
  const search = query.trim().toLowerCase();
  if (!search) return;
  const exactArea = SHIPPING_AREAS.find(area => area.name.toLowerCase() === search);
  if (exactArea) return exactArea;

  await preloadCountryGeometry();
  const code = nameToCountryCode(search) ?? iso3ToIso2Code(search) ?? search.toUpperCase();
  const bbox = getCountryBbox(code);
  if (!bbox) {
    const matches = SHIPPING_AREAS.filter(area => area.name.toLowerCase().includes(search));
    return matches.length === 1 && search.length >= 3 ? matches[0] : undefined;
  }
  const [west, south, east, north] = bbox;
  // Include waters just offshore when searching by country.
  return {
    name: getCountryNameByCode(code) ?? query.trim(),
    bounds: [Math.max(-90, south - 2), Math.max(-180, west - 2), Math.min(90, north + 2), Math.min(180, east + 2)],
  };
}
