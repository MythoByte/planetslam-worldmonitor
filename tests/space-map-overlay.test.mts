import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSpaceMapSnapshot } from '../src/types/space-map';

test('space map normalizes 0–360 forecast longitude and rejects invalid model cells', () => {
  const normalized = normalizeSpaceMapSnapshot({
    aurora: [
      { longitude: 270, latitude: 65, probability: 80 },
      { longitude: 10, latitude: 0, probability: 0 },
      { longitude: 10, latitude: 95, probability: 50 },
      { longitude: NaN, latitude: 50, probability: 50 },
      { longitude: 10, latitude: 65, probability: 150 },
    ], launches: [],
  });
  assert.deepEqual(normalized.aurora, [{ longitude: -90, latitude: 65, probability: 80 }]);
});

test('space overlay retains real zero coordinates while dropping invalid launch positions', () => {
  const launch = { id: 'launch', name: 'Test launch', pad: 'Equator pad', net: Date.now() + 60_000 };
  const normalized = normalizeSpaceMapSnapshot({ aurora: [], launches: [
    { ...launch, longitude: 0, latitude: 0 },
    { ...launch, longitude: Infinity, latitude: 30 },
    { ...launch, longitude: 30, latitude: -91 },
  ] });
  assert.equal(normalized.launches.length, 1);
  assert.equal(normalized.launches[0].longitude, 0);
  assert.equal(normalized.launches[0].latitude, 0);
});

test('space map bounds untrusted forecast work and does not mutate source data', () => {
  const points = Array.from({ length: 15_000 }, () => ({ longitude: 300, latitude: 60, probability: 10 }));
  const normalized = normalizeSpaceMapSnapshot({ aurora: points, launches: [] });
  assert.equal(normalized.aurora.length, 12_000);
  assert.equal(points[0].longitude, 300);
});


test('upcoming launch markers expire by schedule and exclude completed missions', () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const launch = { id: 'launch', name: 'Test launch', pad: 'Pad', longitude: 20, latitude: 30 };
  const normalized = normalizeSpaceMapSnapshot({ aurora: [], launches: [
    { ...launch, id: 'past', net: now - 1 },
    { ...launch, id: 'future', net: now + 60_000, status: 'Go for Launch' },
    { ...launch, id: 'success', net: now + 60_000, status: 'Launch Successful' },
    { ...launch, id: 'failed', net: now + 60_000, status: 'Launch Failure' },
    { ...launch, id: 'cancelled', net: now + 60_000, status: 'Launch Cancelled' },
    { ...launch, id: 'inflight', net: now + 60_000, status: 'Launch in Flight' },
  ] }, now);
  assert.deepEqual(normalized.launches.map(launch => launch.id), ['future']);
});
