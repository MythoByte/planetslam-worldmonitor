import { getRpcBaseUrl } from './rpc-client';
import { validAttackReports, type AttackReportSnapshot } from '@/types/attack-reports';

export async function fetchAttackReports(signal?: AbortSignal): Promise<AttackReportSnapshot> {
  const response = await fetch(`${getRpcBaseUrl()}/api/attack-reports`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('GDELT reports unavailable');
  const data = await response.json();
  if (!Array.isArray(data.reports) || !['fresh', 'stale', 'unavailable'].includes(data.status)) throw new Error('Invalid GDELT report snapshot');
  return { ...data, reports: validAttackReports(data.reports) };
}
