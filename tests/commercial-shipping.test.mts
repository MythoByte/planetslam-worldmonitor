import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { freshCommercialVessels, commercialVesselLabel } from '../src/types/commercial-shipping.ts';

const require = createRequire(import.meta.url);
const { selectCommercialVessels, MAX_AGE_MS, MAX_REPORTS } = require('../scripts/_commercial-shipping.cjs');
const now = 1_800_000_000_000;
const report = (mmsi: string, shipType: number, extra = {}) => ({
  mmsi, name: '', shipType, lat: 25, lon: 55, speed: 12, course: 90, heading: 90, timestamp: now, ...extra,
});

test('commercial reports cover working ship classes, exclude military/unknown/pleasure craft, and resolve late static data', () => {
  const rows = [report('211000001', 70), report('211000002', 80), report('211000003', 60),
    report('211000004', 30), report('211000005', 52), report('211000006', 0),
    report('211000007', 35), report('211000008', 37), report('211000009', 70), report('211000010', 0)];
  const metadata = new Map([['211000010', { shipType: 71, shipName: 'Late static cargo' }]]);
  const result = selectCommercialVessels(new Map(rows.map(r => [r.mmsi, r])), metadata, new Map([['211000009', {}]]), now);
  assert.deepEqual(result.vessels.map((v: { mmsi: string }) => v.mmsi), ['211000001', '211000002', '211000003', '211000004', '211000005', '211000010']);
  assert.equal(result.vessels.at(-1).name, 'Late static cargo');
  assert.equal(result.limited, false);
});

test('relay rejects stale, future and invalid coordinates and bounds the newest reports', () => {
  const rows = [report('211000001', 70, { timestamp: now - MAX_AGE_MS - 1 }), report('211000002', 70, { lat: 91 }),
    report('211000003', 70, { lon: NaN }), report('211000004', 70, { timestamp: now + 1 })];
  for (let i = 0; i < MAX_REPORTS + 1; i++) rows.push(report(String(300000000 + i), 70, { timestamp: now - i }));
  const result = selectCommercialVessels(new Map(rows.map(r => [r.mmsi, r])), new Map(), new Map(), now);
  assert.equal(result.vessels.length, MAX_REPORTS);
  assert.equal(result.vessels[0].mmsi, '300000000');
  assert.equal(result.limited, true);
});

test('browser expires cached positions and preserves ship identity and source in labels', () => {
  const row = report('211000001', 70, { name: 'Synthetic cargo' });
  assert.equal(freshCommercialVessels([row], now).length, 1);
  assert.equal(freshCommercialVessels([row], now + MAX_AGE_MS + 1).length, 0);
  assert.equal(freshCommercialVessels([report('invalid', 70)], now).length, 0);
  assert.match(commercialVesselLabel(row), /Synthetic cargo.*Cargo.*211000001.*12.0 kn.*AISStream/);
});
