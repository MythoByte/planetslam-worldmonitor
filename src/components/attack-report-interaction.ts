import type { AttackReport } from '@/types/attack-reports';
export function selectAttackReport(report: AttackReport): void {
  window.dispatchEvent(new CustomEvent('planetslam:attack-report-select', { detail: report.id }));
}
