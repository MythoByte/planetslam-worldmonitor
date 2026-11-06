/** Public, cached Space datasets. Provider credentials never enter browser payloads. */
export type SpaceDataset = 'apod' | 'news' | 'launches' | 'weather' | 'aurora' | 'solar' | 'events' | 'neo' | 'health';
export interface SpaceEnvelope<T> {
  dataset: SpaceDataset;
  status: 'fresh' | 'stale' | 'unavailable';
  provider: string;
  sourceUrl: string;
  fetchedAt: number | null;
  observedAt: number | null;
  expiresAt: number | null;
  message?: string;
  data: T | null;
}
export interface ApodItem { date: string; title: string; explanation: string; mediaType: string; url: string; hdUrl: string; thumbnailUrl: string; credit: string; sourceUrl: string }
export interface ApodData { items: ApodItem[] }
export interface SpaceNewsItem { id: string; title: string; url: string; summary: string; publisher: string; publishedAt: number; launchIds: string[] }
export interface SpaceNewsData { items: SpaceNewsItem[] }
export interface SpaceLaunch { id: string; name: string; net: number | null; windowStart: number | null; windowEnd: number | null; status: string; provider: string; rocket: string; mission: string; pad: string; latitude: number | null; longitude: number | null; webcastUrl: string; url: string }
export interface LaunchesData { items: SpaceLaunch[] }
export interface WeatherData { scales: { G: number | null; R: number | null; S: number | null }; kp: { time: number; value: number }[]; wind: { time: number; speed: number | null; density: number | null; bz: number | null }[]; alerts: { id: string; message: string; issuedAt: number }[] }
export interface AuroraData { forecastAt: number | null; observationAt: number | null; points: { longitude: number; latitude: number; probability: number }[] }
export interface SolarData { items: { id: string; title: string; url: string; sourceUrl: string; observedAt: number | null }[] }
export interface SpaceEventsData { items: { id: string; type: 'flare' | 'cme'; time: number; classType: string; note: string; url: string }[] }
export interface NeoData { items: { id: string; name: string; approachAt: number; diameterMinKm: number; diameterMaxKm: number; missDistanceKm: number; lunarDistance: number; velocityKmS: number; potentiallyHazardous: boolean; url: string }[] }
export interface SpaceHealthData { items: SpaceEnvelope<never>[] }
