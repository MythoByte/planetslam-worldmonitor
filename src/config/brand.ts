/** Build-time identity only; never put credentials in VITE_* values. */
export const IS_PLANETSLAM = import.meta.env?.VITE_BRAND === 'planetslam';
export const BRAND = {
  name: IS_PLANETSLAM ? 'PlanetSlam' : 'World Monitor',
  wordmark: IS_PLANETSLAM ? 'PLANETSLAM' : 'MONITOR',
  source: 'https://github.com/MythoByte/planetslam-worldmonitor',
  mapCredit: IS_PLANETSLAM ? '© MythoByte' : '© Elie Habib · Someone™',
} as const;
