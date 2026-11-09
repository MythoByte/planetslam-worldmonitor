import type { NewsItem } from '@/types';
import type { CyberNewsData } from '@/types/cyber-dashboard';

const sourceNames: Record<string, string> = { 'Krebs on Security': 'Krebs Security' };
function articleKey(link: string): string {
  try {
    const url = new URL(link);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href.replace(/\/$/, '');
  } catch { return link; }
}

/** Extend the existing Cybersecurity panel, retaining publisher attribution and choices. */
export function mergeTechCyberNews(items: NewsItem[], news: CyberNewsData | null, disabled: ReadonlySet<string>): NewsItem[] {
  const extra: NewsItem[] = (news?.items ?? []).filter(item => !disabled.has(item.publisher)
    && !disabled.has(sourceNames[item.publisher] ?? item.publisher)).map(item => ({
    source: sourceNames[item.publisher] ?? item.publisher, title: item.title, link: item.url,
    pubDate: new Date(item.publishedAt), isAlert: false, description: item.summary,
  }));
  const seen = new Set<string>();
  return [...items, ...extra].filter(item => {
    const key = articleKey(item.link);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}
