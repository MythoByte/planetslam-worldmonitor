/** Public, cached Space datasets. Provider credentials never enter browser payloads. */
export type SpaceDataset = 'apod' | 'news' | 'launches' | 'weather' | 'aurora' | 'solar' | 'events' | 'neo' | 'orbits' | 'missions' | 'brief' | 'health';
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

export type MissionDatePrecision = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'quarter' | 'year' | 'unknown';
export interface SpaceMissionEvent {
  id: string;
  name: string;
  kind: 'spacewalk' | 'docking' | 'landing' | 'briefing' | 'other';
  type: string;
  description: string;
  date: number;
  datePrecision: MissionDatePrecision;
  datePrecisionDescription: string;
  windowStart: number | null;
  windowEnd: number | null;
  durationSeconds: number | null;
  location: string;
  status: string;
  webcastUrl: string;
  url: string;
  launchIds: string[];
  updatedAt: number | null;
}
export interface MissionsData { items: SpaceMissionEvent[]; totalCount: number; truncated: boolean }

export type OrbitGroupId = 'stations' | 'weather' | 'science' | 'communications' | 'starlink';
/** CelesTrak GP JSON uses OMM keywords. Numeric units follow CCSDS OMM/SGP4. */
export interface SpaceOmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  NORAD_CAT_ID: number;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  ELEMENT_SET_NO: number;
  EPHEMERIS_TYPE?: 0;
  CLASSIFICATION_TYPE?: 'U' | 'C';
  REV_AT_EPOCH?: number;
}
export interface OrbitObject {
  noradId: string;
  name: string;
  objectId: string;
  epoch: number;
  groups: OrbitGroupId[];
  omm: SpaceOmmRecord;
  elementStatus: 'fresh' | 'stale';
}
export interface OrbitGroupHealth {
  id: OrbitGroupId;
  label: string;
  providerGroup: string;
  sourceUrl: string;
  status: 'fresh' | 'stale' | 'unavailable';
  fetchedAt: number | null;
  objectCount: number;
  totalCount: number;
  truncated: boolean;
  refreshFailed?: boolean;
  message?: string;
}
export interface OrbitCatalogData { items: OrbitObject[]; groups: OrbitGroupHealth[]; complete: boolean }

/** Dated central source snapshot; never a live space-weather or viewing forecast. */
export type SpaceBriefInputDataset = Exclude<SpaceDataset, 'brief' | 'health'>;
export interface SpaceBriefSource {
  id: string;
  dataset: SpaceBriefInputDataset;
  title: string;
  url: string;
  fetchedAt: number;
  observedAt: number | null;
  expiresAt: number;
  freshUntil: number;
  status: 'fresh' | 'stale';
}
export interface SpaceBriefSection { id: string; heading: string; summary: string; sourceIds: string[] }
export interface SpaceBriefCoverage {
  dataset: SpaceBriefInputDataset;
  status: 'fresh' | 'stale' | 'unavailable';
  fetchedAt: number | null;
  observedAt: number | null;
  expiresAt: number | null;
  freshUntil: number | null;
  itemCount: number;
}
export interface SpaceBriefData {
  date: string;
  generatedAt: number;
  mode: 'ai' | 'source-summary';
  model: string | null;
  title: string;
  items: SpaceBriefSection[];
  sources: SpaceBriefSource[];
  coverage: SpaceBriefCoverage[];
  limitations: string[];
}
