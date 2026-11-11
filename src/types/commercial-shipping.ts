export interface CommercialVessel {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  shipType: number;
  speed: number;
  heading: number;
  course: number;
  timestamp: number;
}

export interface CommercialShippingSnapshot {
  vessels: CommercialVessel[];
  available: boolean;
  limited: boolean;
}

export type CommercialShippingBounds = [south: number, west: number, north: number, east: number];

export function commercialVesselCategory(type: number): string {
  if (type >= 80 && type <= 89) return 'Tanker';
  if (type >= 70 && type <= 79) return 'Cargo';
  if (type >= 60 && type <= 69) return 'Passenger';
  if (type === 30) return 'Fishing';
  return 'Tug / towing';
}

export function commercialVesselLabel(vessel: CommercialVessel): string {
  const speed = Number.isFinite(vessel.speed) && vessel.speed >= 0 && vessel.speed < 102.3 ? `${vessel.speed.toFixed(1)} kn` : 'Speed unavailable';
  return `${vessel.name || 'Unnamed vessel'} · ${commercialVesselCategory(vessel.shipType)} · MMSI ${vessel.mmsi} · ${speed} · received ${new Date(vessel.timestamp).toUTCString()} · AISStream`;
}

export function freshCommercialVessels(vessels: CommercialVessel[], now = Date.now()): CommercialVessel[] {
  return vessels.filter(v => v && typeof v === 'object' && /^\d{9}$/.test(v.mmsi) && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90
    && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180 && Number.isFinite(v.timestamp)
    && v.timestamp <= now && now - v.timestamp <= 10 * 60_000).slice(0, 2000);
}
