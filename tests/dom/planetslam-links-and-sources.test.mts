import { afterEach, describe, expect, it, vi } from 'vitest';
const brand = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/config/brand', () => ({
  get IS_PLANETSLAM() { return brand.enabled; },
  BRAND: { name: 'PlanetSlam', wordmark: 'PLANETSLAM', source: '' },
}));
const { resolvePlanetSlamLink } = await import('@/config/planetslam-links');
const { installPlanetSlamLinks } = await import('@/services/planetslam-links');
const { rewritePlanetSlamHtmlLinks, localPagePaths } = await import('../../branding/vite-plugin');
const { App } = await import('@/App');
const { STORAGE_KEYS } = await import('@/config');
const { FEEDS, INTEL_SOURCES } = await import('@/config/feeds');
const { selectSourcesUnderCap } = await import('@/services/source-cap');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
afterEach(() => { brand.enabled = true; localStorage.clear(); document.body.replaceChildren(); });

describe('PlanetSlam destination policy', () => {
  it('maps verified pages and edition deep links while retaining query and fragment', () => {
    expect(resolvePlanetSlamLink('https://www.worldmonitor.app/dashboard?c=US#map')).toBe('https://planetslam.com/dashboard?c=US#map');
    expect(resolvePlanetSlamLink('https://tech.worldmonitor.app/dashboard?c=GB')).toBe('https://planetslam.com/dashboard?c=GB&variant=tech');
    expect(resolvePlanetSlamLink('//www.worldmonitor.app/blog/')).toBe('https://planetslam.com/blog/');
  });
  it('removes absent docs, status, support, hosted MCP and Pro destinations', () => {
    for (const url of ['https://worldmonitor.app/docs/terms', 'https://status.worldmonitor.app/', 'https://worldmonitor.app/mcp', 'https://worldmonitor.app/pro', 'mailto:support@worldmonitor.app']) {
      expect(resolvePlanetSlamLink(url)).toBeNull();
    }
    expect(resolvePlanetSlamLink('https://worldmonitor.app/pro', new Set(['/pro']))).toBeNull();
  });
  it('leaves providers, source attribution, relative links and lookalike hosts alone', () => {
    for (const url of ['https://github.com/koala73/worldmonitor', '/dashboard', 'https://worldmonitor.app.evil.example/docs', 'https://worldmonitor.app@elsewhere.example/']) {
      expect(resolvePlanetSlamLink(url)).toBe(url);
    }
  });
  it('uses actual HTML files rather than treating a SPA fallback as a page', () => {
    const root = mkdtempSync(join(tmpdir(), 'ps-pages-'));
    try {
      mkdirSync(join(root, 'blog'), { recursive: true });
      writeFileSync(join(root, 'blog/index.html'), '<h1>Actual blog</h1>');
      const paths = localPagePaths(root);
      expect(paths.has('/blog')).toBe(true);
      expect(paths.has('/docs/terms')).toBe(false);
      expect(rewritePlanetSlamHtmlLinks('<link rel="canonical" href="https://worldmonitor.app/blog/">', paths)).toBe('<link rel="canonical" href="https://planetslam.com/blog/">');
      expect(rewritePlanetSlamHtmlLinks('<link rel="canonical" href="https://worldmonitor.app/docs/terms">', paths)).toBe('');
      expect(rewritePlanetSlamHtmlLinks('<a class="ok" href="https://worldmonitor.app/blog/">Blog</a><a href="https://worldmonitor.app/docs/terms">Terms</a>', paths)).toBe('<a class="ok" href="https://planetslam.com/blog/">Blog</a>');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('handles links inserted or changed after Settings/briefs render', async () => {
    const dispose = installPlanetSlamLinks(document.body);
    try {
      document.body.innerHTML = '<a id="keep" href="https://www.worldmonitor.app/dashboard?c=US">Country</a><a id="remove" href="https://worldmonitor.app/docs/terms">Terms</a>';
      await vi.waitFor(() => expect(document.querySelector('#keep')?.getAttribute('href')).toBe('https://planetslam.com/dashboard?c=US'));
      expect(document.querySelector('#remove')).toBeNull();
      document.querySelector('#keep')!.setAttribute('href', 'https://worldmonitor.app/mcp');
      await vi.waitFor(() => expect(document.querySelector('#keep')).toBeNull());
    } finally { dispose(); }
  });
  it('preserves default World Monitor link rendering', () => {
    brand.enabled = false;
    document.body.innerHTML = '<a href="https://worldmonitor.app/docs/terms">Terms</a>';
    const dispose = installPlanetSlamLinks(document.body);
    expect(document.querySelector('a')?.getAttribute('href')).toBe('https://worldmonitor.app/docs/terms');
    dispose();
  });
});

function reconcileAsFree() {
  const app = Object.create(App.prototype) as unknown as {
    state: { disabledSources: Set<string> };
    reconcileSourceLimitForTier: (pro: boolean) => void;
  };
  app.state = { disabledSources: new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.disabledFeeds) || '[]')) };
  app.reconcileSourceLimitForTier(false);
  return app.state.disabledSources;
}
describe('PlanetSlam source limit removal', () => {
  it('restores only cap-owned disables and keeps user choices across reload reconciliation', () => {
    const manual = 'User disabled fixture';
    localStorage.setItem(STORAGE_KEYS.disabledFeeds, JSON.stringify([manual, 'Reuters', 'BBC World']));
    localStorage.setItem(STORAGE_KEYS.sourceGateOwnership, JSON.stringify(['Reuters', 'BBC World']));
    expect([...reconcileAsFree()]).toEqual([manual]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.sourceGateOwnership)!)).toEqual([]);
    expect([...reconcileAsFree()]).toEqual([manual]);
  });
  it('keeps more than 80 enabled sources for anonymous PlanetSlam users', () => {
    localStorage.setItem(STORAGE_KEYS.disabledFeeds, '[]');
    localStorage.setItem(STORAGE_KEYS.sourceGateOwnership, '[]');
    const names = new Set([...Object.values(FEEDS).flatMap(feeds => feeds ?? []), ...INTEL_SOURCES].map(f => f.name));
    expect(names.size).toBeGreaterThan(80);
    expect(reconcileAsFree().size).toBe(0);
    brand.enabled = false;
    const defaults = selectSourcesUnderCap(FEEDS, INTEL_SOURCES, new Set(), 80);
    expect(defaults.autoDisabled.size).toBeGreaterThan(0);
    expect(reconcileAsFree().size).toBeGreaterThan(0);
  });
});
