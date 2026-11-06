import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cyberMatches, getCyberWatchlist, saveCyberWatchlist } from '../src/services/cyber-watchlist';
test('watchlist matches literal terms with boundaries and no regex injection', () => {
  assert.deepEqual(cyberMatches('Docker Engine vulnerability', ['docker', 'go', 'engine']), ['docker', 'engine']);
  assert.deepEqual(cyberMatches('Google update', ['go']), []);
  assert.deepEqual(cyberMatches('ASP.NET Core update', ['asp.net', '.*']), ['asp.net']);
  assert.deepEqual(cyberMatches('Linux kernel', ['linux']), ['linux']);
});

test('watchlist saves normalized bounded terms and reports unavailable or rejected storage', () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const win = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: null });
    assert.deepEqual(getCyberWatchlist(), []);
    assert.equal(saveCyberWatchlist(['Docker']), false);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } });
    assert.equal(saveCyberWatchlist([' Docker ', 'docker', 'Linux', 'x']), true);
    assert.deepEqual(getCyberWatchlist(), ['docker', 'linux']);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => '["docker"]', setItem: () => { throw new Error('Synthetic quota rejection'); },
    } });
    assert.equal(saveCyberWatchlist(['Nextcloud']), false);
    assert.deepEqual(getCyberWatchlist(), ['docker']);
  } finally {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (win) Object.defineProperty(globalThis, 'window', win); else Reflect.deleteProperty(globalThis, 'window');
  }
});
