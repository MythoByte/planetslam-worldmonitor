export interface AttackReport {
  id: string;
  latitude: number;
  longitude: number;
  locationName: string;
  locationPrecision: 'country' | 'region' | 'place';
  sourceUrl: string;
  publisher: string;
  eventDate: string;
  indexedAt: number;
  articleCount: number;
  kind: 'aerial';
  verification: 'reported';
}

export interface AttackReportSnapshot {
  reports: AttackReport[];
  status: 'fresh' | 'stale' | 'unavailable';
  updatedAt: number;
  latestBatchAt: number;
  coverageStart: number;
  completeWindow: boolean;
  limited: boolean;
}

export function attackReportLabel(report: AttackReport): string {
  return `Reported aerial attack · ${report.locationName} · Event date ${report.eventDate} · GDELT indexed ${new Date(report.indexedAt).toUTCString()} · Approximate ${report.locationPrecision} location · ${report.publisher} · Unverified`;
}

export function validAttackReports(reports: readonly AttackReport[], now = Date.now()): AttackReport[] {
  return reports.filter(r => r && r.verification === 'reported' && r.kind === 'aerial'
    && typeof r.id === 'string' && /^gdelt-air-\d+$/.test(r.id)
    && Number.isFinite(r.latitude) && Math.abs(r.latitude) <= 90 && Number.isFinite(r.longitude) && Math.abs(r.longitude) <= 180
    && Number.isFinite(r.indexedAt) && r.indexedAt >= now - 24 * 60 * 60_000 && r.indexedAt <= now + 15 * 60_000
    && typeof r.locationName === 'string' && typeof r.publisher === 'string'
    && ['country', 'region', 'place'].includes(r.locationPrecision)
    && typeof r.eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.eventDate) && r.eventDate >= new Date(now - 24 * 60 * 60_000).toISOString().slice(0,10) && r.eventDate <= new Date(now).toISOString().slice(0,10)
    && safeAttackReportUrl(r.sourceUrl)).slice(0, 500);
}

export function safeAttackReportUrl(value: string): boolean {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
