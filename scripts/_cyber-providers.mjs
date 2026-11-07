import { fetchEpss, fetchCvss } from './_cyber-priority.mjs';
import { normalizeCyberIncidents, readSharedCyberInfrastructure } from './_cyber-incidents.mjs';
import { CYBER_DATASETS, httpsUrl, validCyberData } from '../api/_cyber-data.js';
import { parseRssItems } from './seed-climate-news.mjs';
const clean = (v, max) => typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const dayTime = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? Date.parse(`${v}T00:00:00Z`) : NaN;
export function normalizeKev(raw) {
  if (!Array.isArray(raw?.vulnerabilities) || !raw.vulnerabilities.length || raw.count !== raw.vulnerabilities.length || raw.count > 10000) throw new Error('Invalid KEV catalog');
  const seen = new Set();
  const items = raw.vulnerabilities.map(i => {
    if (seen.has(i.cveID)) throw new Error('Duplicate CVE'); seen.add(i.cveID);
    return { id: i.cveID, vendor: clean(i.vendorProject, 160), product: clean(i.product, 200), title: clean(i.vulnerabilityName, 400),
      description: clean(i.shortDescription, 1200), action: clean(i.requiredAction, 1200), addedAt: dayTime(i.dateAdded), dueDate: i.dueDate,
      ransomware: i.knownRansomwareCampaignUse, url: `https://www.cve.org/CVERecord?id=${encodeURIComponent(i.cveID)}`,
      references: (typeof i.notes === 'string' ? i.notes.match(/https:\/\/[^\s;<>]+/g) || [] : []).map(httpsUrl).filter(Boolean).slice(0, 8) };
  }).sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id));
  const data = { items, totalCount: raw.count, version: clean(raw.catalogVersion, 40), catalogAt: Date.parse(raw.dateReleased) };
  if (!validCyberData('kev', data)) throw new Error('Invalid KEV entries');
  return { data, observedAt: data.catalogAt };
}
export function newsTopic(text) {
  if (/ransomware|extortion/i.test(text)) return 'Ransomware';
  if (/vulnerabilit|CVE-\d|zero.day|patch/i.test(text)) return 'Vulnerabilities';
  if (/breach|data leak|stolen data/i.test(text)) return 'Breaches';
  if (/malware|botnet|trojan|backdoor/i.test(text)) return 'Malware';
  if (/phish|scam|credential/i.test(text)) return 'Phishing';
  return 'Security';
}
export function normalizeCyberNews(xml, name, now = Date.now()) {
  const config = CYBER_DATASETS[name];
  if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error('Invalid news feed');
  const items = parseRssItems(xml, config.provider).flatMap(i => {
    const url = httpsUrl(i.url), title = clean(i.title, 500), summary = clean(i.summary, 500);
    if (!url || !title || !Number.isFinite(i.publishedAt) || i.publishedAt <= 0 || i.publishedAt > now + 60_000) return [];
    return [{ id: i.id, title, summary, publisher: config.provider, url, publishedAt: i.publishedAt, topic: newsTopic(title + ' ' + summary) }];
  }).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 100);
  const data = { items };
  if (!validCyberData(name, data)) throw new Error('No valid news entries');
  return { data, observedAt: items[0].publishedAt };
}
async function readProvider(url, fetchFn) {
  const response = await fetchFn(url, { headers: { 'User-Agent': 'PlanetSlam-Cyber/1.0 (+https://planetslam.com)', Accept: 'application/json, application/rss+xml, application/atom+xml, text/xml' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('Provider unavailable');
  // Bound reads even when the response omits Content-Length.
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8_000_000) throw new Error('Provider payload too large'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(buffer);
}
export async function fetchCyberDataset(name, { fetchFn = fetch, now = Date.now(), command } = {}) {
  if (!Object.hasOwn(CYBER_DATASETS, name)) throw new Error('Unknown dataset');
  if (name === 'epss') return fetchEpss({ fetchFn, command, now });
  if (name === 'cvss') return fetchCvss({ fetchFn, command, now, readJson: async (url, fn) => JSON.parse(await readProvider(url, fn)) });
  if (name === 'infrastructure') return readSharedCyberInfrastructure(command, now);
  if (name === 'incidents') return normalizeCyberIncidents(JSON.parse(await readProvider('https://base44.app/api/apps/68c3041c75bb09b9728e4b37/entities/CyberEvent?sort=-event_date&limit=20', fetchFn)), now);
  if (name !== 'kev') return normalizeCyberNews(await readProvider(CYBER_DATASETS[name].feedUrl, fetchFn), name, now);
  try { return normalizeKev(JSON.parse(await readProvider(CYBER_DATASETS.kev.feedUrl, fetchFn))); }
  catch { return normalizeKev(JSON.parse(await readProvider('https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json', fetchFn))); }
}
