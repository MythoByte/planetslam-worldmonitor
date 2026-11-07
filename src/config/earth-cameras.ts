/** Curated official cameras. Coordinates locate the camera, not an event in its view. */
export type EarthCameraKind = 'volcano' | 'coast' | 'mountain' | 'river' | 'weather';
export interface EarthCamera {
  readonly id: string;
  readonly title: string;
  readonly operator: string;
  readonly sourceUrl: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly kind: EarthCameraKind;
  readonly region: string;
  readonly imageUrl?: string;
  readonly entries?: readonly string[];
  readonly refreshMs?: number;
  readonly creditUrl?: string;
}

export const EARTH_CAMERA_KINDS: readonly EarthCameraKind[] = ['volcano', 'coast', 'mountain', 'river', 'weather'];
export const EARTH_CAMERAS: readonly EarthCamera[] = [
  {
    id: 'kilauea-v1', title: 'Kīlauea · Halemaʻumaʻu west', operator: 'USGS Hawaiian Volcano Observatory',
    sourceUrl: 'https://www.usgs.gov/volcanoes/kilauea/summit-webcams', latitude: 19.421, longitude: -155.287,
    kind: 'volcano', region: 'Hawaiʻi', entries: ['https://www.youtube.com/watch?v=HggWKlZv9yk'],
  },
  {
    id: 'ruapehu-north', title: 'Ruapehu from the north', operator: 'GeoNet / Earth Sciences New Zealand · CC BY 3.0 NZ',
    sourceUrl: 'https://www.geonet.org.nz/about/volcano/cameras', latitude: -39.16732, longitude: 175.48055,
    kind: 'volcano', region: 'New Zealand', imageUrl: 'https://images.geonet.org.nz/volcano/cameras/latest/m-ruapehunorth.jpg', refreshMs: 600_000,
    creditUrl: 'https://www.geonet.org.nz/policy',
  },
  {
    id: 'whakaari-tekaha', title: 'Whakaari / White Island from Te Kaha', operator: 'GeoNet / Earth Sciences New Zealand · CC BY 3.0 NZ',
    sourceUrl: 'https://www.geonet.org.nz/volcano/monitoring/whiteisland', latitude: -37.748423, longitude: 177.692166,
    kind: 'volcano', region: 'New Zealand', imageUrl: 'https://images.geonet.org.nz/volcano/cameras/latest/m-tekaha.jpg', refreshMs: 600_000,
    creditUrl: 'https://www.geonet.org.nz/policy',
  },
  {
    id: 'raoul-island', title: 'Raoul Island · Kermadec Islands', operator: 'GeoNet / Earth Sciences New Zealand · CC BY 3.0 NZ',
    sourceUrl: 'https://www.geonet.org.nz/about/volcano/cameras', latitude: -29.267332, longitude: -177.907235,
    kind: 'volcano', region: 'New Zealand', imageUrl: 'https://images.geonet.org.nz/volcano/cameras/latest/m-raoulisland.jpg', refreshMs: 600_000,
    creditUrl: 'https://www.geonet.org.nz/policy',
  },
  {
    id: 'redwood-pacific', title: 'Redwood · Pacific coast', operator: 'National Park Service',
    sourceUrl: 'https://www.nps.gov/redw/learn/photosmultimedia/webcams.htm', latitude: 41.286, longitude: -124.093,
    kind: 'coast', region: 'Western United States', imageUrl: 'https://www.nps.gov/webcams-redw/KVC_Pacific_Ocean.jpg', refreshMs: 60_000,
  },
  {
    id: 'paria-colorado', title: 'Paria Overlook · Colorado River', operator: 'National Park Service',
    sourceUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B467B9-1DD8-B71B-0BA34037897F857D', latitude: 36.867, longitude: -111.588,
    kind: 'river', region: 'Western United States', imageUrl: 'https://www.nps.gov/webcams-glca/po1.jpg', refreshMs: 600_000,
  },
  {
    id: 'rainier-paradise', title: 'Mount Rainier · Paradise', operator: 'National Park Service',
    sourceUrl: 'https://www.nps.gov/mora/learn/photosmultimedia/webcams.htm', latitude: 46.786, longitude: -121.735,
    kind: 'mountain', region: 'Western United States', imageUrl: 'https://www.nps.gov/webcams-mora/mountain.jpg', refreshMs: 300_000,
  },
  {
    id: 'washburn-south', title: 'Mount Washburn · southern view', operator: 'National Park Service',
    sourceUrl: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm', latitude: 44.798, longitude: -110.434,
    kind: 'mountain', region: 'Western United States', imageUrl: 'https://www.nps.gov/webcams-yell/washburn_sw.jpg', refreshMs: 60_000,
  },
  {
    id: 'barrow-observatory', title: 'Utqiaġvik · Barrow Observatory', operator: 'NOAA Global Monitoring Laboratory',
    sourceUrl: 'https://gml.noaa.gov/obop/brw/livecamera.html', latitude: 71.323, longitude: -156.611,
    kind: 'weather', region: 'Alaska', imageUrl: 'https://gml.noaa.gov/webdata/brw/webcam/archive.jpg', refreshMs: 300_000,
  },
];

export function earthCameraDistanceKm(latitude: number, longitude: number, camera: Pick<EarthCamera, 'latitude' | 'longitude'>): number {
  const rad = Math.PI / 180;
  const a = Math.sin((camera.latitude - latitude) * rad / 2) ** 2
    + Math.cos(latitude * rad) * Math.cos(camera.latitude * rad) * Math.sin((camera.longitude - longitude) * rad / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}

export function nearbyEarthCameras(latitude: number, longitude: number, maxKm = 250): EarthCamera[] {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(maxKm) || maxKm < 0) return [];
  return EARTH_CAMERAS.filter(camera => earthCameraDistanceKm(latitude, longitude, camera) <= maxKm)
    .sort((a, b) => earthCameraDistanceKm(latitude, longitude, a) - earthCameraDistanceKm(latitude, longitude, b));
}
