import * as d3 from 'd3';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MapComponent } from '@/components/Map';
import { MapContainer } from '@/components/MapContainer';
import { GlobeMap } from '@/components/GlobeMap';
import { createCyberMapLayers } from '@/components/cyber-map-layers';
import type { CyberMapSnapshot } from '@/types/cyber-map';
const snapshot: CyberMapSnapshot = { markers: [
  { id: 'incident-test', kind: 'incident', label: '<script>Synthetic</script>', country: 'US', category: 'Encryption', latitude: 40, longitude: -100 },
  { id: 'infra-test', kind: 'infrastructure', label: '198[.]51[.]100[.]42', country: 'DE', category: 'C2 SERVER', latitude: 51, longitude: 10 },
] };
afterEach(() => document.body.replaceChildren());
describe('Cyber native map adapters', () => {
  it('projects SVG markers from real geographic coordinates and dispatches safe keyboard selection', () => {
    const svg = d3.select(document.body).append('svg');
    const map = Object.assign(Object.create(MapComponent.prototype), { dynamicLayerGroup: svg.append('g'), cyberMap: snapshot });
    const projection = d3.geoEquirectangular().translate([400, 200]).scale(100);
    const picked = vi.fn(); window.addEventListener('planetslam:cyber-marker', picked, { once: true });
    map.renderCyberMap(projection);
    const el = document.querySelector('[data-cyber-marker="incident-test"]')!;
    const point = projection([-100, 40])!;
    expect(Number(el.getAttribute('cx'))).toBeCloseTo(point[0]);
    expect(Number(el.getAttribute('cy'))).toBeCloseTo(point[1]);
    expect(el.getAttribute('aria-label')).toContain('approximate country location');
    expect(el.querySelector('script')).toBeNull();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(picked.mock.calls[0]?.[0].detail).toEqual({ id: 'incident-test', kind: 'incident' });
  });
  it('builds separate DeckGL data layers with bounded native coordinates and selection callbacks', () => {
    const layers = createCyberMapLayers(snapshot);
    expect(layers.map(layer => layer.id)).toEqual(['cyber-native-incident', 'cyber-native-infrastructure']);
    const layer = layers[0]!;
    expect((layer.props.getPosition as Function)(snapshot.markers[0])).toEqual([-100, 40]);
    expect(layer.props.radiusMaxPixels).toBe(14);
    const picked = vi.fn(); window.addEventListener('planetslam:cyber-marker', picked, { once: true });
    (layer.props.onClick as Function)({ object: snapshot.markers[0] });
    expect(picked.mock.calls[0]?.[0].detail.kind).toBe('incident');
    expect(createCyberMapLayers({ markers: [] })).toEqual([]);
  });
  it('routes snapshots through the active renderer and retains the source snapshot for rehydration', () => {
    const svg = { setCyberMap: vi.fn() }, deck = { setCyberMap: vi.fn() }, globe = { setCyberMap: vi.fn() };
    const map = Object.assign(Object.create(MapContainer.prototype), { svgMap: svg, deckGLMap: deck, globeMap: globe, useDeckGL: false, useGlobe: false });
    map.setCyberMap(snapshot); map.useDeckGL = true; map.setCyberMap(snapshot); map.useGlobe = true; map.setCyberMap(snapshot);
    for (const renderer of [svg, deck, globe]) expect(renderer.setCyberMap).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(map.cachedCyberMap).toBe(snapshot);
  });
  it('keeps globe marker latitude/longitude and escapes the point label', () => {
    const globe: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const key of ['pointsData', 'pointLat', 'pointLng', 'pointColor', 'pointRadius', 'pointAltitude', 'pointLabel', 'pointsTransitionDuration', 'onPointClick']) globe[key] = vi.fn(() => globe);
    const map = Object.assign(Object.create(GlobeMap.prototype), { globe, initialized: true, destroyed: false, webglLost: false, layers: {}, spaceOverlay: { aurora: [], launches: [] }, spaceOrbits: null });
    map.setCyberMap(snapshot);
    expect(globe.pointLat).toHaveBeenCalledWith('latitude'); expect(globe.pointLng).toHaveBeenCalledWith('longitude');
    const points = globe.pointsData!.mock.calls[0]![0];
    expect(points[0]).toMatchObject({ latitude: 40, longitude: -100, cyberKind: 'incident' });
    expect(globe.pointLabel!.mock.calls[0]![0](points[0])).toContain('&lt;script&gt;');
  });
});
