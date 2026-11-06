export interface CyberMapMarker {
  id: string; kind: 'incident' | 'infrastructure'; label: string;
  latitude: number; longitude: number; country: string; category: string;
}
export interface CyberMapSnapshot { markers: CyberMapMarker[] }
export function normalizeCyberMap(snapshot: CyberMapSnapshot): CyberMapSnapshot {
  const seen = new Set<string>();
  return { markers: snapshot.markers.filter(i => {
    const key = i.kind + ':' + i.id;
    if (!['incident', 'infrastructure'].includes(i.kind) || !Number.isFinite(i.latitude) || Math.abs(i.latitude) > 90
      || !Number.isFinite(i.longitude) || Math.abs(i.longitude) > 180 || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 520) };
}
export const cyberMarkerLabel = (m: CyberMapMarker): string => `${m.label} · ${m.kind === 'incident' ? 'Reported incident · approximate country location' : 'Infrastructure indicator · approximate geolocation'} · ${m.country} · ${m.category}. Location does not identify the attacker.`;
