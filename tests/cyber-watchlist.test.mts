import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cyberMatches } from '../src/services/cyber-watchlist';
test('watchlist matches literal terms with boundaries and no regex injection', () => {
  assert.deepEqual(cyberMatches('Docker Engine vulnerability', ['docker', 'go', 'engine']), ['docker', 'engine']);
  assert.deepEqual(cyberMatches('Google update', ['go']), []);
  assert.deepEqual(cyberMatches('ASP.NET Core update', ['asp.net', '.*']), ['asp.net']);
  assert.deepEqual(cyberMatches('Linux kernel', ['linux']), ['linux']);
});
