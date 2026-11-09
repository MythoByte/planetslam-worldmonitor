import assert from 'node:assert/strict';
import test from 'node:test';
import { globalEarthMapSnapshot } from '../src/services/earth-global-map';
import { canonicalPlanetSlamVariant, SITE_VARIANTS } from '../src/config/variant';
import type { EarthMapMarker } from '../src/types/earth-map';
const base: EarthMapMarker = { id: 'usgs:quake', sourceId: 'usgs', kind: 'event', hazard: 'earthquake', title: 'Fixture quake', mode: 'observed', severity: 'unknown', latitude: 0, longitude: 0 };
const all = { fires: true, natural: true, weather: true, webcams: true };
test('Global keeps each existing provider record once and adds only unmatched Earth locations', () => {
  const unique = { ...base, id: 'eonet:volcano', sourceId: 'eonet', hazard: 'volcano' };
  const result = globalEarthMapSnapshot({ markers: [base, unique, { ...unique }] }, all, [{ id: 'quake' }]);
  assert.deepEqual(result.markers, [unique]);
});
test('shared native toggles control Earth natural, alert, and camera additions', () => {
  const alert = { ...base, id: 'nws:alert', sourceId: 'nws', hazard: 'flood' };
  const camera: EarthMapMarker = { ...base, id: 'camera', kind: 'camera', hazard: 'camera' };
  const snapshot = { markers: [base, alert, camera] };
  assert.deepEqual(globalEarthMapSnapshot(snapshot, { fires: false, natural: false, weather: true, webcams: false }, []).markers, [alert]);
  assert.deepEqual(globalEarthMapSnapshot(snapshot, { fires: false, natural: false, weather: false, webcams: false }, []).markers, []);
  assert.deepEqual(globalEarthMapSnapshot(snapshot, all, []).markers, snapshot.markers);
});
test('Fires owns supplementary wildfire locations independently of Natural Events', () => {
  const fire = { ...base, id: 'fire', hazard: 'wildfire' };
  assert.equal(globalEarthMapSnapshot({ markers: [fire] }, { ...all, fires: false }, []).markers.length, 0);
  assert.equal(globalEarthMapSnapshot({ markers: [fire] }, { ...all, natural: false }, []).markers.length, 1);
});
test('late-arriving Global source data suppresses its matching Earth marker', () => {
  const snapshot = { markers: [base] };
  assert.equal(globalEarthMapSnapshot(snapshot, all, []).markers.length, 1);
  assert.equal(globalEarthMapSnapshot(snapshot, all, [{ id: 'quake' }]).markers.length, 0);
  assert.equal(snapshot.markers.length, 1);
});
test('canonical event permalinks deduplicate aliases, while general source pages do not collapse distinct cameras', () => {
  const event = { ...base, id: 'alias', sourceUrl: 'http://example.com/events/quake#context' };
  assert.equal(globalEarthMapSnapshot({ markers: [event] }, all, [{ id: 'other', sourceUrl: 'https://example.com/events/quake' }]).markers.length, 0);
  const cameras: EarthMapMarker[] = ['a', 'b'].map(id => ({ ...base, kind: 'camera', id, sourceUrl: 'https://example.com/cameras', hazard: 'camera' }));
  assert.equal(globalEarthMapSnapshot({ markers: cameras }, all, []).markers.length, 2);
});
test('retired edition links resolve to Global while service variant IDs remain supported', () => {
  assert.equal(canonicalPlanetSlamVariant('space'), 'full');
  assert.equal(canonicalPlanetSlamVariant('earth'), 'full');
  assert.equal(canonicalPlanetSlamVariant('cyber'), 'tech');
  for (const variant of ['full', 'tech', 'finance', 'energy', 'commodity', 'happy'] as const) assert.equal(canonicalPlanetSlamVariant(variant), variant);
  assert.ok(SITE_VARIANTS.includes('space') && SITE_VARIANTS.includes('earth'));
});

test('native EONET, GDACS and NWS identifier formats match Earth provider IDs', () => {
  for (const [earthId, nativeId] of [['eonet:EONET_123', 'eonet-EONET_123'], ['eonet:EONET_123', 'EONET_123'], ['gdacs:TC:123', 'gdacs-TC-123'], ['nws:https://api.weather.gov/alerts/urn:oid:123', 'urn:oid:123']]) {
    assert.equal(globalEarthMapSnapshot({ markers: [{ ...base, id: earthId! }] }, all, [{ id: nativeId! }]).markers.length, 0);
  }
});
