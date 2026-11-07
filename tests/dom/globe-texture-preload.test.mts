import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { document.head.querySelectorAll('link[data-test-globe], link[rel="preload"][as="image"]').forEach(link => link.remove()); });

it('preloads the saved texture with Three-compatible CORS, without changing the setting or requesting its alternative', async () => {
  localStorage.setItem('wm-globe-texture', 'blue-marble');
  const { preloadGlobeTexture, getGlobeTexture } = await import('@/services/globe-render-settings');
  const release = preloadGlobeTexture();
  const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]');
  expect(links).toHaveLength(1); expect(links[0]!.getAttribute('href')).toBe('/textures/earth-blue-marble.jpg');
  expect(links[0]!.crossOrigin).toBe('anonymous'); expect(getGlobeTexture()).toBe('blue-marble');
  release(); expect(document.head.contains(links[0]!)).toBe(false);
});
it('deduplicates shared pending hints and removes them only after all requesting renderers release', async () => {
  const { preloadGlobeTexture } = await import('@/services/globe-render-settings');
  const first = preloadGlobeTexture(), second = preloadGlobeTexture();
  expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(1);
  first(); first(); expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(1);
  second(); expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(0);
});
it('does not repeat a completed preload and allows retry after an error', async () => {
  const { preloadGlobeTexture } = await import('@/services/globe-render-settings');
  preloadGlobeTexture('blue-marble');
  document.head.querySelector('link[rel="preload"][as="image"]')!.dispatchEvent(new Event('error'));
  const retry = preloadGlobeTexture('blue-marble');
  const hint = document.head.querySelector('link[rel="preload"][as="image"]')!; expect(hint).not.toBeNull();
  hint.dispatchEvent(new Event('load')); retry(); preloadGlobeTexture('blue-marble');
  expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(0);
});
