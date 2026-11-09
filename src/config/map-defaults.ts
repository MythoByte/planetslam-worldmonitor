import { IS_PLANETSLAM } from './brand';

/** Explicit URL/user ranges still take precedence over this new-view default. */
export const DEFAULT_MAP_TIME_RANGE = IS_PLANETSLAM ? '24h' : '7d';
