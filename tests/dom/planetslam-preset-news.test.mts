import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@/app/app-context';
vi.mock('@/config/brand', () => ({ IS_PLANETSLAM: true }));
import { DataLoaderManager } from '@/app/data-loader';

type Internals = {
  tryFetchDigest(): Promise<unknown>;
  loadPersistedDigest(): Promise<null>;
  persistDigest(): void;
  resolveEnabledNewsCategories(): Array<{ key: string }>;
};
function loader() {
  const ctx = { dashboardFeedVariant: 'full', panelSettings: {}, newsCategoryPanelKeys: new Map(), newsPanels: {}, disabledSources: new Set(), statusPanel: { updateDigestCoverage: vi.fn() } } as unknown as AppContext;
  const instance = new DataLoaderManager(ctx, { renderCriticalBanner: vi.fn(), refreshOpenCountryBrief: vi.fn() });
  const internal = instance as unknown as Internals;
  internal.loadPersistedDigest = async () => null;
  internal.persistDigest = vi.fn();
  return { ctx, internal };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('PlanetSlam preset news scope', () => {
  it('switches feed categories with the preset while keeping custom enabled news panels', () => {
    const { ctx, internal } = loader();
    ctx.dashboardFeedVariant = 'happy';
    const happy = internal.resolveEnabledNewsCategories().map(category => category.key);
    ctx.dashboardFeedVariant = 'tech';
    ctx.panelSettings.middleeast = { name: 'Middle East', enabled: true, priority: 1 };
    ctx.newsCategoryPanelKeys.set('middleeast', 'middleeast');
    const tech = internal.resolveEnabledNewsCategories().map(category => category.key);
    expect(tech).toContain('middleeast');
    expect(tech).toContain('ai');
    expect(tech).not.toEqual(happy);
  });

  it('does not let one preset outage suppress requests for a newly selected preset', async () => {
    const { ctx, internal } = loader();
    const fetch = vi.fn(async (_url: RequestInfo | URL) => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await internal.tryFetchDigest();
    await internal.tryFetchDigest();
    await internal.tryFetchDigest();
    expect(fetch).toHaveBeenCalledTimes(2);
    ctx.dashboardFeedVariant = 'energy';
    await internal.tryFetchDigest();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[2]?.[0])).toContain('variant=energy');
  });
});
