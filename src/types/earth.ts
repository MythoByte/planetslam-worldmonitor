/** Public Earth wire contracts; credentials and provider requests stay server-side. */
export type EarthDataset = 'earthquakes' | 'events' | 'alerts' | 'weather' | 'news' | 'health' | 'rivers' | 'airquality' | 'history';
export type EarthStatus = 'fresh' | 'stale' | 'unavailable';
export type EarthHazard = 'earthquake' | 'flood' | 'wildfire' | 'storm' | 'volcano' | 'tsunami' | 'weather' | 'other' | 'heat' | 'cold' | 'drought' | 'tornado' | 'lightning' | 'hail' | 'winter' | 'landslide' | 'avalanche' | 'coastal';
export type EarthSeverity = 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
export interface EarthSource {
  id: string; provider: string; status: EarthStatus; fetchedAt: number | null; observedAt: number | null; coverage: string; message?: string; sourceUrl?: string; expiresAt?: number | null; staleAt?: number | null; observationMaxAgeMs?: number | null;
}
export interface EarthEnvelope<T> {
  dataset: EarthDataset; status: EarthStatus; provider: string; sourceUrl: string; coverage: string;
  fetchedAt: number | null; observedAt: number | null; expiresAt: number | null; message?: string; sources?: EarthSource[]; data: T | null;
}
export interface EarthItems<T> { items: T[]; sources?: EarthSource[] }
export interface EarthEvent {
  id: string; sourceId: string; title: string; kind: EarthHazard; hazards?: EarthHazard[]; latitude: number | null; longitude: number | null;
  region: string; severity: EarthSeverity; status: string; mode: 'observed' | 'forecast' | 'warning';
  observedAt: number; expiresAt: number | null; url: string; provider: string; summary: string; locationApproximate?: boolean; magnitude?: number; depthKm?: number;
}
export interface EarthNewsItem {
  id: string; sourceId: string; title: string; url: string; summary: string; publisher: string; publishedAt: number;
  kind: EarthHazard; hazards?: EarthHazard[]; region: string; official: boolean; relatedUrls?: string[];
}
export interface EarthWeatherPoint {
  time: number; temperatureC: number | null; windKmh: number | null; precipitationMm: number | null; symbol: string;
}
export interface EarthWeatherItem {
  id: string; sourceId: string; name: string; latitude: number; longitude: number; region: string;
  modelRunAt: number; current: EarthWeatherPoint; forecast: EarthWeatherPoint[]; sourceUrl: string;
}
export type EarthHealthData = EarthItems<EarthEnvelope<never>>;
export interface EarthEventFilter { hazard?: string; region?: string; severity?: string; hours?: number }
export interface EarthSelection { id: string; kind: 'event' | 'camera'; latitude?: number; longitude?: number; nearby?: boolean; origin?: 'map' | 'panel' }
export const EARTH_SELECT_EVENT = 'planetslam:earth-select';
export const EARTH_HAZARDS: readonly EarthHazard[] = ['earthquake', 'flood', 'wildfire', 'storm', 'volcano', 'tsunami', 'heat', 'cold', 'drought', 'tornado', 'lightning', 'hail', 'winter', 'landslide', 'avalanche', 'coastal', 'weather', 'other'];
export const EARTH_HAZARD_LABELS: Record<EarthHazard, string> = {
  earthquake: 'Earthquakes', flood: 'Flooding', wildfire: 'Wildfires', storm: 'Tropical & severe storms', volcano: 'Volcanoes', tsunami: 'Tsunamis', heat: 'Heatwaves & extreme heat', cold: 'Extreme cold & frost', drought: 'Drought', tornado: 'Tornadoes', lightning: 'Lightning threats', hail: 'Hail threats', winter: 'Winter storms', landslide: 'Landslides', avalanche: 'Avalanches', coastal: 'Coastal & marine hazards', weather: 'Weather', other: 'Other natural events',
};

export interface EarthRiverItem {
  id: string; sourceId: string; name: string; latitude: number; longitude: number; region: string;
  observedAt: number; stage: number; unit: string; floodCategory: string;
  thresholds: { action: number | null; minor: number | null; moderate: number | null; major: number | null }; sourceUrl: string;
}
export interface EarthAirQualityItem {
  id: string; sourceId: string; name: string; countryCode: string; latitude: number; longitude: number; region: string;
  observedAt: number; pm25: number; aqi: number; riskLevel: string; provider: string; sourceUrl: string;
}

/** Recorded source snapshots, rather than a reconstructed continuous history. */
export interface EarthHistoryFrame {
  recordedAt: number; sources: EarthSource[]; eventKeys: string[]; totalEvents: number; truncated: boolean;
}
export interface EarthHistoryRecord { key: string; event: EarthEvent }
export interface EarthHistoryData { items: EarthHistoryFrame[]; events: EarthHistoryRecord[] }
