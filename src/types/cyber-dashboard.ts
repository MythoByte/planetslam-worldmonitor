export type CyberDataset = 'news' | 'kev' | 'health' | 'incidents' | 'infrastructure' | 'epss' | 'cvss' | 'brief';
export interface CyberEnvelope<T = CyberData> {
  dataset: string; status: 'fresh' | 'stale' | 'unavailable'; provider: string; sourceUrl: string;
  fetchedAt: number | null; observedAt: number | null; expiresAt: number | null; message?: string; data: T | null;
}
export interface CyberNewsItem { id: string; title: string; summary: string; publisher: string; url: string; publishedAt: number; topic: string }
export interface CyberKevItem { id: string; vendor: string; product: string; title: string; description: string; action: string; addedAt: number; dueDate: string; ransomware: 'Known' | 'Unknown'; url: string; references: string[] }
export interface CyberNewsData { items: CyberNewsItem[] }
export interface CyberKevData { items: CyberKevItem[]; version: string; catalogAt: number; totalCount: number }
export interface CyberHealthData { items: CyberEnvelope[] }
export type CyberData = CyberNewsData | CyberKevData | CyberHealthData | CyberIncidentData | CyberInfrastructureData | CyberEpssData | CyberCvssData | CyberBriefData;

export interface CyberIncident {
  id: string; organization: string; country: string; countryCode: string; sector: string; category: string;
  description: string; eventAt: number; reportedAt: number; updatedAt: number | null;
  verification: 'reported' | 'claim-reported'; latitude: number | null; longitude: number | null;
  url: string; reportUrl: string; changeLog: string;
}
export interface CyberIncidentData { items: CyberIncident[]; coverage: string }
export interface CyberInfrastructure {
  id: string; indicator: string; source: string; country: string; countryCode: string; category: string;
  observedAt: number; latitude: number | null; longitude: number | null; url: string;
}
export interface CyberInfrastructureData { items: CyberInfrastructure[]; totalCount: number; truncated: boolean; sourceFetchedAt: number }

export interface CyberEpssItem { id: string; probability: number; percentile: number }
export interface CyberEpssData { items: CyberEpssItem[]; requestedCount: number; catalogFetchedAt: number; scoreDate: string; model: string }
export interface CyberCvssItem { id: string; score: number | null; version: string | null; provider: string | null; vector: string | null; updatedAt: number | null }
export interface CyberCvssData { items: CyberCvssItem[]; catalogFetchedAt: number }

export interface CyberBriefEvidence {
  id: string; dataset: string; kind: 'news' | 'kev' | 'research'; title: string; publisher: string; url: string;
  publishedAt: number; fetchedAt: number; expiresAt: number; freshUntil: number; status: 'fresh' | 'stale' | 'unavailable';
  facts: { id: string; text: string }[];
}
export interface CyberBriefData {
  date: string; generatedAt: number; periodStart: number; periodEnd: number; mode: 'ai-curated' | 'source-summary'; model: string | null;
  aiStatus: 'curated' | 'not-configured' | 'failed' | 'rejected' | 'admission-used'; candidates: CyberBriefEvidence[];
  items: { id: string; factIds: string[] }[];
  coverage: { dataset: string; status: 'fresh' | 'stale' | 'unavailable'; fetchedAt: number | null; observedAt: number | null;
    expiresAt: number | null; freshUntil: number | null; itemCount: number; selectedCount: number }[];
}
