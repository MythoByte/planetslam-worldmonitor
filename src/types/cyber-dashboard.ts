export type CyberDataset = 'news' | 'kev' | 'health';
export interface CyberEnvelope<T = CyberData> {
  dataset: string; status: 'fresh' | 'stale' | 'unavailable'; provider: string; sourceUrl: string;
  fetchedAt: number | null; observedAt: number | null; expiresAt: number | null; message?: string; data: T | null;
}
export interface CyberNewsItem { id: string; title: string; summary: string; publisher: string; url: string; publishedAt: number; topic: string }
export interface CyberKevItem { id: string; vendor: string; product: string; title: string; description: string; action: string; addedAt: number; dueDate: string; ransomware: 'Known' | 'Unknown'; url: string; references: string[] }
export interface CyberNewsData { items: CyberNewsItem[] }
export interface CyberKevData { items: CyberKevItem[]; version: string; catalogAt: number; totalCount: number }
export interface CyberHealthData { items: CyberEnvelope[] }
export type CyberData = CyberNewsData | CyberKevData | CyberHealthData;
