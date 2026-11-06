import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCyberIncidents, projectCyberInfrastructure } from '../scripts/_cyber-incidents.mjs';
import { cyberEnvelope, aggregateCyberNews } from '../api/_cyber-data.js';
import { seedCyber } from '../scripts/seed-cyber-dashboard.mjs';
const now = Date.now();
const row = (patch = {}) => ({ id: 'synthetic-id', organization: 'Synthetic Hospital', country: 'United States', country_iso3: 'USA', industry: 'Healthcare', event_subtype: 'Encryption', description: 'An alleged attack, synthetic fixture only.', event_date: new Date(now - 86400_000).toISOString().slice(0, 10), reported_date: new Date(now).toISOString().slice(0, 10), updated_date: new Date(now).toISOString(), source_url: 'https://example.com/report', ...patch });
const threat = (patch = {}) => ({ id: 'synthetic-ioc', source: 'CYBER_THREAT_SOURCE_FEODO', type: 'CYBER_THREAT_TYPE_C2_SERVER', indicator: '198.51.100.42', country: 'US', firstSeenAt: now - 86400_000, lastSeenAt: now - 1000, location: { latitude: 40, longitude: -100 }, ...patch });
test('incident sample retains original reports, research status, country-level locations and source dates', () => {
  const result = normalizeCyberIncidents([row()], now);
  const item = result.data.items[0];
  assert.equal(item.countryCode, 'US'); assert.ok(item.latitude !== null);
  assert.equal(item.verification, 'claim-reported'); assert.equal(item.reportUrl, 'https://example.com/report');
  assert.notEqual(item.eventAt, item.reportedAt); assert.equal(item.updatedAt, now);
  assert.match(item.url, /eventdetails\?id=synthetic-id/);
  assert.equal('actor' in item, false); assert.equal('created_by' in item, false);
});
test('unknown country stays unlocated; bad links remain text-free; empty/future/oversized samples fail', () => {
  const item = normalizeCyberIncidents([row({ country_iso3: 'Undetermined', country: 'Undetermined', source_url: 'javascript:alert(1)' })], now).data.items[0];
  assert.equal(item.latitude, null); assert.equal(item.longitude, null); assert.equal(item.countryCode, 'unknown'); assert.equal(item.reportUrl, '');
  assert.throws(() => normalizeCyberIncidents([], now));
  assert.throws(() => normalizeCyberIncidents([row({ reported_date: '2099-01-01' })], now));
  assert.throws(() => normalizeCyberIncidents([row(), row()], now));
  assert.throws(() => normalizeCyberIncidents(Array.from({ length: 21 }, (_, i) => row({ id: String(i) })), now));
  assert.throws(() => normalizeCyberIncidents([row({ is_sample: true })], now));
});
test('infrastructure projection preserves the canonical collection clock, omits missing coordinates and rejects corrupt/expired data', () => {
  const fetchedAt = now - 2 * 3600_000;
  const result = projectCyberInfrastructure({ _seed: { fetchedAt, recordCount: 2 }, data: { threats: [threat(), threat({ id: 'unlocated', location: undefined })] } }, { fetchedAt: now }, now);
  assert.equal(result.fetchedAt, fetchedAt); assert.equal(result.data.sourceFetchedAt, fetchedAt);
  assert.equal(result.data.items[1].latitude, null);
  assert.equal(cyberEnvelope('infrastructure', { dataset: 'infrastructure', ...result }, now).status, 'fresh');
  assert.equal(cyberEnvelope('infrastructure', { dataset: 'infrastructure', ...result, fetchedAt: now }, now).status, 'unavailable');
  assert.throws(() => projectCyberInfrastructure({ threats: [threat()] }, { fetchedAt: now - 4 * 3600_000 }, now));
  assert.throws(() => projectCyberInfrastructure({ threats: [null] }, { fetchedAt: now }, now));
});
test('worker publishing an infrastructure projection never refreshes its source age', async () => {
  const projected = projectCyberInfrastructure({ threats: [threat()] }, { fetchedAt: now - 3600_000 }, now);
  let written;
  await seedCyber({ names: ['infrastructure'], now, command: async () => ({ result: 'OK' }), lock: async () => true, unlock: async () => {}, fetchDataset: async () => projected, publish: async value => { written = value; } });
  assert.equal(written.fetchedAt, now - 3600_000); assert.equal(written.data.fetchedAt, now - 3600_000);
});
test('news aggregation never mixes incident or infrastructure rows into article results', () => {
  const incidents = normalizeCyberIncidents([row()], now);
  const envelope = cyberEnvelope('incidents', { dataset: 'incidents', fetchedAt: now, ...incidents }, now);
  assert.equal(aggregateCyberNews([envelope], now).data, null);
});
