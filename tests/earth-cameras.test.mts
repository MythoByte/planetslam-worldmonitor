import assert from 'node:assert/strict';
import test from 'node:test';
import { EARTH_CAMERAS, EARTH_CAMERA_KINDS, earthCameraDistanceKm, nearbyEarthCameras, isEarthYouTubeCamera } from '../src/config/earth-cameras.ts';
import { parseSource } from '../src/services/live-video/model.ts';

test('Earth catalog has attributed, geolocated official sources with explicitly playable media', () => {
  assert.equal(new Set(EARTH_CAMERAS.map(camera => camera.id)).size, EARTH_CAMERAS.length);
  for (const camera of EARTH_CAMERAS) {
    assert.ok(camera.title && camera.operator && camera.region);
    assert.ok(Number.isFinite(camera.latitude) && Math.abs(camera.latitude) <= 90);
    assert.ok(Number.isFinite(camera.longitude) && Math.abs(camera.longitude) <= 180);
    assert.ok(EARTH_CAMERA_KINDS.includes(camera.kind));
    assert.equal(new URL(camera.sourceUrl).protocol, 'https:');
    assert.ok(Boolean(camera.imageUrl) !== Boolean(camera.entries?.length), camera.id);
    if (camera.imageUrl) {
      assert.equal(new URL(camera.imageUrl).protocol, 'https:');
      assert.ok((camera.refreshMs ?? 0) >= 60_000);
    } else {
      const source = parseSource({ slot: `earth/${camera.id}`, entries: camera.entries ?? [], origin: 'builtin' });
      assert.ok(source.candidates.length > 0, `${camera.id} is recognized by the shared video player`);
      assert.equal(source.problem, null);
    }
    if (camera.operator.startsWith('GeoNet')) assert.equal(camera.creditUrl, 'https://www.geonet.org.nz/policy');
  }
  for (const kind of EARTH_CAMERA_KINDS) assert.ok(EARTH_CAMERAS.some(camera => camera.kind === kind));
});

test('nearby cameras use distance rather than sharing a hazard category or country', () => {
  const kilauea = EARTH_CAMERAS.find(camera => camera.id === 'kilauea-v1')!;
  assert.equal(earthCameraDistanceKm(kilauea.latitude, kilauea.longitude, kilauea), 0);
  const hawaii = nearbyEarthCameras(kilauea.latitude, kilauea.longitude);
  assert.deepEqual(hawaii.map(camera => camera.id), ['kilauea-v1', 'kilauea-v2', 'kilauea-v3']);
  assert.deepEqual(nearbyEarthCameras(0, 0), []);
  assert.deepEqual(nearbyEarthCameras(NaN, 0), []);
  assert.deepEqual(nearbyEarthCameras(91, 0), []);
  assert.deepEqual(nearbyEarthCameras(0, 181), []);
  assert.deepEqual(nearbyEarthCameras(0, 0, -1), []);
});

test('distance wraps the dateline and returns cameras in nearest-first order', () => {
  assert.ok(earthCameraDistanceKm(0, 179.5, { latitude: 0, longitude: -179.5 }) < 112);
  const cameras = nearbyEarthCameras(-38, 176, 1500);
  assert.ok(cameras.length > 1);
  for (let i = 1; i < cameras.length; i++) {
    assert.ok(earthCameraDistanceKm(-38, 176, cameras[i - 1]!) <= earthCameraDistanceKm(-38, 176, cameras[i]!));
  }
});

test('YouTube media filtering selects only explicit player sources and retains official operator lineage', () => {
  const videos = EARTH_CAMERAS.filter(isEarthYouTubeCamera);
  assert.equal(videos.length, 5);
  for (const camera of videos) {
    assert.equal(camera.imageUrl, undefined);
    assert.equal(camera.sourceCheckedAt, '2026-11-07');
    const parsed = parseSource({ slot: `earth/${camera.id}`, entries: camera.entries!, origin: 'builtin' });
    assert.ok(parsed.candidates.every(candidate => candidate.candidate.kind === 'video'), camera.id);
  }
  assert.equal(isEarthYouTubeCamera({ entries: ['https://youtube.com.example.org/live/fake'] }), false);
  assert.equal(isEarthYouTubeCamera({ entries: ['https://example.org/live.m3u8'] }), false);
  assert.equal(isEarthYouTubeCamera({ entries: ['not a URL'] }), false);
  assert.equal(isEarthYouTubeCamera({}), false);
  assert.ok(EARTH_CAMERAS.find(camera => camera.id === 'reykjanes-mosaic')!.note!.includes('Several camera views'));
  assert.ok(EARTH_CAMERAS.find(camera => camera.id === 'monterey-bay')!.note!.includes('recorded footage'));
});
