import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CYBER_FILTERS, filterCyberIncidents, filterCyberInfrastructure, cyberMapSnapshot, defangCyberIndicator } from '../src/services/cyber-explore';
import { normalizeCyberMap } from '../src/types/cyber-map';
import type { CyberIncident, CyberInfrastructure } from '../src/types/cyber-dashboard';
const now = Date.now();
const incident = { id: 'i', organization: 'Synthetic Clinic', countryCode: 'US', country: 'United States', sector: 'Healthcare', category: 'Encryption', description: '', reportedAt: now - 86400_000, latitude: 40, longitude: -100 } as CyberIncident;
const infra = { id: 'c2', indicator: '198.51.100.42', source: 'FEODO', countryCode: 'DE', country: 'DE', category: 'C2 SERVER', observedAt: now, latitude: 51, longitude: 10 } as CyberInfrastructure;
test('country, sector, category, search and reported-period filters narrow only the intended records', () => {
  const f = { ...DEFAULT_CYBER_FILTERS, country: 'US' };
  assert.equal(filterCyberIncidents([incident], f, now).length, 1);
  assert.equal(filterCyberInfrastructure([infra], f, now).length, 0);
  assert.equal(filterCyberIncidents([incident], { ...f, sector: 'Finance' }, now).length, 0);
  assert.equal(filterCyberInfrastructure([infra], { ...DEFAULT_CYBER_FILTERS, sector: 'Healthcare' }, now).length, 1);
  assert.equal(filterCyberIncidents([incident], { ...f, category: 'C2 SERVER' }, now).length, 0);
  assert.equal(filterCyberIncidents([incident], { ...f, query: 'clinic' }, now).length, 1);
  assert.equal(filterCyberIncidents([{ ...incident, reportedAt: now - 40 * 86400_000 }], { ...f, days: '30' }, now).length, 0);
});
test('two map layers stay separate, exclude missing geometry and honor independent toggles', () => {
  const all = cyberMapSnapshot([incident, { ...incident, id: 'unknown', latitude: null, longitude: null }], [infra], DEFAULT_CYBER_FILTERS);
  assert.deepEqual(all.markers.map(m => m.kind), ['incident', 'infrastructure']);
  assert.equal(cyberMapSnapshot([incident], [infra], { ...DEFAULT_CYBER_FILTERS, incidents: false }).markers.length, 1);
  assert.equal(cyberMapSnapshot([incident], [infra], { ...DEFAULT_CYBER_FILTERS, infrastructure: false }).markers[0]?.kind, 'incident');
  assert.equal(normalizeCyberMap({ markers: [...all.markers, { ...all.markers[0]!, latitude: NaN }, all.markers[0]!] }).markers.length, 2);
  assert.equal(defangCyberIndicator('https://example.test/path'), 'hxxps://example[.]test/path');
});
