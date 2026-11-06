import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CYBER_DATASETS, cyberEnvelope, aggregateCyberNews } from '../api/_cyber-data.js';
import { normalizeKev, normalizeCyberNews, fetchCyberDataset } from '../scripts/_cyber-providers.mjs';
import { seedCyber } from '../scripts/seed-cyber-dashboard.mjs';
const now = Date.now();
const news = (name = 'bleeping', age = 0) => ({ dataset: name, fetchedAt: now - age, observedAt: now - 1000,
  data: { items: [{ id: 'synthetic-news', title: 'Synthetic Docker vulnerability', summary: '<script>fixture</script>', publisher: 'Synthetic publisher', url: 'https://example.com/story', publishedAt: now - 1000, topic: 'Vulnerabilities' }] } });
const rawKev = () => ({ count: 1, catalogVersion: 'synthetic-1', dateReleased: new Date(now).toISOString(), vulnerabilities: [{ cveID: 'CVE-2026-99999', vendorProject: 'Synthetic', product: 'Docker', vulnerabilityName: 'Synthetic fixture', shortDescription: 'Fixture, not a real vulnerability.', requiredAction: 'Apply vendor updates.', dateAdded: '2026-11-01', dueDate: '2026-11-20', knownRansomwareCampaignUse: 'Unknown', notes: 'https://example.com/advisory; javascript:alert(1)' }] });

test('KEV normalizer preserves all entries and action metadata; malformed/partial catalogs fail', () => {
  const result = normalizeKev(rawKev());
  assert.equal(result.data.items[0].ransomware, 'Unknown');
  assert.equal(result.data.items[0].action, 'Apply vendor updates.');
  assert.deepEqual(result.data.items[0].references, ['https://example.com/advisory']);
  assert.throws(() => normalizeKev({ ...rawKev(), count: 2 }));
  const malformed = rawKev(); malformed.vulnerabilities[0].dueDate = null;
  assert.throws(() => normalizeKev(malformed));
});
test('freshness ages the original successful fetch; invalid and expired snapshots hide data', () => {
  assert.equal(cyberEnvelope('bleeping', news(), now).status, 'fresh');
  assert.equal(cyberEnvelope('bleeping', { ...news(), data: { items: [null] } }, now).status, 'unavailable');
  const delayed = cyberEnvelope('bleeping', news('bleeping', 31 * 60_000), now);
  assert.equal(delayed.status, 'stale');
  assert.equal(delayed.fetchedAt, now - 31 * 60_000);
  assert.equal(cyberEnvelope('bleeping', news('bleeping', 7 * 3600_000), now).data, null);
  assert.equal(cyberEnvelope('bleeping', { ...news(), fetchedAt: now + 120_000 }, now).status, 'unavailable');
  assert.equal(cyberEnvelope('bleeping', { ...news(), data: { items: [{ ...news().data.items[0], url: 'javascript:alert(1)' }] } }, now).data, null);
});
test('news aggregation retains partial coverage, deduplicates tracking links, and excludes old/future stories', () => {
  const a = cyberEnvelope('bleeping', news(), now);
  const b = cyberEnvelope('krebs', { ...news('krebs'), data: { items: [
    { ...news().data.items[0], url: 'https://example.com/story?utm_source=fixture' },
    { ...news().data.items[0], url: 'https://example.com/old', publishedAt: now - 8 * 86400_000 },
    { ...news().data.items[0], url: 'https://example.com/future', publishedAt: now + 86400_000 },
  ] } }, now);
  const c = cyberEnvelope('hackernews', null, now);
  const result = aggregateCyberNews([a, b, c], now);
  assert.equal(result.status, 'stale'); assert.equal(result.data.items.length, 1);
  assert.match(result.message, /unavailable/);
  assert.equal(aggregateCyberNews([c], now).data, null);
});
test('RSS rejects HTML error pages, unsafe URLs, future dates and invalid feeds', () => {
  assert.throws(() => normalizeCyberNews('<html>Access denied</html>', 'bleeping', now));
  const rss = `<rss><channel><item><title>Docker patch fixture</title><link>https://example.com/rss</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>Test summary</description></item><item><title>Unsafe</title><link>javascript:alert(1)</link><pubDate>${new Date(now).toUTCString()}</pubDate></item></channel></rss>`;
  const result = normalizeCyberNews(rss, 'bleeping', now);
  assert.equal(result.data.items.length, 1); assert.equal(result.data.items[0].topic, 'Vulnerabilities');
});
test('CISA provider falls back only to the official catalog mirror', async () => {
  const urls = [];
  const result = await fetchCyberDataset('kev', { fetchFn: async url => { urls.push(url); return urls.length === 1 ? new Response('', { status: 403 }) : Response.json(rawKev()); } });
  assert.equal(result.data.totalCount, 1);
  assert.equal(urls[1], 'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json');
});
test('worker publishes valid snapshots with atomic metadata; failures preserve last-good data and cooldown', async () => {
  const writes = [], releases = [], commands = [];
  const options = { names: ['bleeping', 'krebs'], now, lock: async () => true, unlock: async (...args) => releases.push(args),
    command: async args => { commands.push(args); return { result: 'OK' }; }, publish: async args => writes.push(args),
    fetchDataset: async name => { if (name === 'krebs') throw new Error('Synthetic upstream failure'); return { data: news().data, observedAt: now }; } };
  const results = await seedCyber(options);
  assert.deepEqual(results.map(r => r.status), ['published', 'failed']);
  assert.equal(writes.length, 1); assert.equal(writes[0].key, 'cyber-dashboard:bleeping:v1');
  assert.equal(writes[0].extra.observedAt, now); assert.equal(releases.length, 2);
  assert.deepEqual(commands[0].slice(3), ['NX', 'PX', CYBER_DATASETS.bleeping.intervalMs]);
  const blocked = await seedCyber({ ...options, names: ['bleeping'], command: async () => ({ result: null }), fetchDataset: async () => { throw new Error('Must not fetch'); } });
  assert.equal(blocked[0].status, 'cooldown'); assert.equal(writes.length, 1);
});
