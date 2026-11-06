/** Renderer-neutral space overlays. Coordinates are geographic degrees. */
export interface SpaceAuroraPoint {
  longitude: number;
  latitude: number;
  probability: number;
}

export interface SpaceLaunchMarker {
  id: string;
  name: string;
  pad: string;
  latitude: number;
  longitude: number;
  net: number;
  status?: string;
}

export interface SpaceMapSnapshot {
  aurora: SpaceAuroraPoint[];
  launches: SpaceLaunchMarker[];
}

export const EMPTY_SPACE_MAP: SpaceMapSnapshot = { aurora: [], launches: [] };

/** Bound renderer work and reject invalid coordinates, never coerce missing values to zero. */
export function normalizeSpaceMapSnapshot(snapshot: SpaceMapSnapshot, now = Date.now()): SpaceMapSnapshot {
  const validCoordinate = (point: { longitude: number; latitude: number }) =>
    Number.isFinite(point.longitude) && Number.isFinite(point.latitude)
    && point.longitude >= -180 && point.longitude <= 360
    && point.latitude >= -90 && point.latitude <= 90;
  return {
    aurora: snapshot.aurora.filter(point => validCoordinate(point)
      && Number.isFinite(point.probability) && point.probability >= 5 && point.probability <= 100)
      .slice(0, 12_000).map(point => ({ ...point, longitude: ((point.longitude + 540) % 360) - 180 })),
    launches: snapshot.launches.filter(launch => validCoordinate(launch)
      && Number.isFinite(launch.net) && launch.net >= now
      && !/success|fail|cancel|in\s*flight|inflight/i.test(launch.status ?? '')).slice(0, 100)
      .map(point => ({ ...point, longitude: ((point.longitude + 540) % 360) - 180 })),
  };
}
