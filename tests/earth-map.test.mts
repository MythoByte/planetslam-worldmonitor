import assert from 'node:assert/strict';
import test from 'node:test';
import { earthEventMarker } from '../src/types/earth-map';
import type { EarthEvent } from '../src/types/earth';
const event: EarthEvent = { id: 'synthetic', sourceId: 'synthetic', title: 'Synthetic event', kind: 'earthquake', mode: 'observed',
  latitude: 0, longitude: 0, region: 'Global', severity: 'unknown', status: 'reported', observedAt: Date.now(), expiresAt: null,
  provider: 'Synthetic provider', summary: '', url: 'https://example.org/' };
test('Earth map retains valid zero coordinates and unknown severity without inventing coordinates', () => {
  assert.deepEqual(earthEventMarker(event), { id: 'synthetic', kind: 'event', title: 'Synthetic event', hazard: 'earthquake',
    mode: 'observed', severity: 'unknown', latitude: 0, longitude: 0 });
  for (const [latitude, longitude] of [[null, 12], [10, null], [NaN, 12], [91, 12], [0, 181]]) {
    assert.equal(earthEventMarker({ ...event, latitude, longitude }), null);
  }
});
