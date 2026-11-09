import { describe, expect, it } from 'vitest';
import { mergeTechCyberNews } from '@/services/tech-cyber-news';

describe('merged Tech security news', () => {
  const existing = [{ source: 'Krebs Security', title: 'Existing report', link: 'https://example.com/report', pubDate: new Date(200), isAlert: false }];
  const news = { items: [
    { id: 'duplicate', publisher: 'Krebs on Security', title: 'Same report', summary: '', url: 'https://example.com/report?utm_source=cyber#top', publishedAt: 300, topic: 'Other' },
    { id: 'new', publisher: 'BleepingComputer', title: 'Additional report', summary: 'Source excerpt', url: 'https://example.com/additional', publishedAt: 400, topic: 'Other' },
  ] };
  it('adds unique source reports once, newest first, retaining the existing duplicate', () => {
    const result = mergeTechCyberNews(existing, news, new Set());
    expect(result.map(item => item.title)).toEqual(['Additional report', 'Existing report']);
    expect(mergeTechCyberNews(result, news, new Set())).toEqual(result);
  });
  it('honors disabled source aliases and preserves Tech news during an outage', () => {
    expect(mergeTechCyberNews([], news, new Set(['Krebs Security', 'BleepingComputer']))).toEqual([]);
    expect(mergeTechCyberNews(existing, null, new Set())).toEqual(existing);
  });
});
