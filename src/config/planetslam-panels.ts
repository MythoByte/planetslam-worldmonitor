import { IS_PLANETSLAM } from './brand';
import { PLANETSLAM_SOURCE_PANEL_NAMES } from '@/shared/planetslam-local-panels';
export { PLANETSLAM_SOURCE_PANEL_NAMES };

export function isPlanetSlamSourcePanel(key: string): boolean {
  return IS_PLANETSLAM && Object.prototype.hasOwnProperty.call(PLANETSLAM_SOURCE_PANEL_NAMES, key);
}
