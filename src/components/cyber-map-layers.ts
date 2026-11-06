import { ScatterplotLayer } from '@deck.gl/layers';
import type { CyberMapSnapshot, CyberMapMarker } from '@/types/cyber-map';
import { selectCyberMarker } from './cyber-map-interaction';
export function createCyberMapLayers(snapshot: CyberMapSnapshot | null): ScatterplotLayer<CyberMapMarker>[] {
  return (['incident', 'infrastructure'] as const).flatMap(kind => {
    const markers = snapshot?.markers.filter(m => m.kind === kind) ?? [];
    return markers.length ? [new ScatterplotLayer<CyberMapMarker>({
      id: `cyber-native-${kind}`, data: markers,
      getPosition: m => [m.longitude, m.latitude], getRadius: kind === 'incident' ? 15000 : 8000,
      getFillColor: kind === 'incident' ? [255, 188, 80, 230] : [189, 145, 255, 210],
      stroked: true, getLineColor: [240, 240, 255, 220], lineWidthMinPixels: 0.7,
      radiusMinPixels: kind === 'incident' ? 6 : 3, radiusMaxPixels: 14, pickable: true,
      onClick: info => { if (info.object) selectCyberMarker(info.object); return true; },
    })] : [];
  });
}
