import { afterEach, describe, expect, it, vi } from 'vitest';
const brand = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/config/brand', () => ({
  get IS_PLANETSLAM() { return brand.enabled; },
  BRAND: { name: 'PlanetSlam', wordmark: 'PLANETSLAM', source: '' },
}));
const { getEffectivePanelConfig, getInitialPanelSettingsForVariant, isPanelHiddenForBrand, isPanelEntitled, restorePlanetSlamSourcePanels } = await import('@/config/panels');
const { hasPanelDataAccess, hasPremiumAccess } = await import('@/services/panel-gating');
const { Panel } = await import('@/components/Panel');
const restored = ['stock-analysis', 'stock-backtest', 'daily-market-brief', 'deduction'];
const panels: InstanceType<typeof Panel>[] = [];
afterEach(() => { panels.splice(0).forEach(panel => panel.destroy()); brand.enabled = true; localStorage.clear(); });

describe('source-backed PlanetSlam panels', () => {
  it('restores only supported source panels, without granting a Pro account', () => {
    const settings = getInitialPanelSettingsForVariant('full');
    for (const key of restored) {
      const config = getEffectivePanelConfig(key, 'full');
      expect(config.premium).toBeUndefined();
      expect(config.name).not.toMatch(/pro|premium/i);
      expect(settings[key]?.enabled).toBe(true);
      expect(isPanelHiddenForBrand(key, 'full')).toBe(false);
      expect(isPanelEntitled(key, config, false)).toBe(true);
      expect(hasPanelDataAccess(key)).toBe(true);
    }
    expect(hasPremiumAccess()).toBe(false);
    for (const key of ['latest-brief', 'chat-analyst', 'market-implications', 'wsb-ticker-scanner', 'regional-intelligence', 'global-procurement', 'trade-policy']) {
      expect(isPanelHiddenForBrand(key, 'full')).toBe(true);
      expect(hasPanelDataAccess(key)).toBe(false);
    }
  });
  it('restores previous lock-owned disables once, preserving later user choices and other panels', () => {
    const old = {
      'stock-analysis': { name: 'Premium Stock Analysis', enabled: false, priority: 1, premium: 'locked' as const },
      politics: { name: 'World News', enabled: false, priority: 1 },
    };
    const recovered = restorePlanetSlamSourcePanels(old, 'full');
    expect(recovered['stock-analysis']?.enabled).toBe(true);
    expect(recovered['stock-analysis']?.premium).toBeUndefined();
    expect(recovered.politics).toEqual(old.politics);
    expect(old['stock-analysis'].enabled).toBe(false);
    recovered['stock-analysis']!.enabled = false;
    expect(restorePlanetSlamSourcePanels(recovered, 'full')).toBe(recovered);
    expect(recovered['stock-analysis']?.enabled).toBe(false);
  });
  it('keeps source-backed panels out of unrelated edition defaults', () => {
    for (const variant of ['earth', 'space', 'cyber', 'happy']) {
      const settings = getInitialPanelSettingsForVariant(variant);
      for (const key of restored) expect(settings[key]?.enabled).toBe(false);
    }
  });
  it('removes constructor-level Premium titles and Pro badges on restored panels', () => {
    for (const id of restored) {
      const panel = new Panel({ id, title: 'Premium Analysis', premium: 'locked' });
      panels.push(panel);
      expect(panel.getElement().querySelector('.panel-pro-badge')).toBeNull();
      expect(panel.getElement().querySelector('.panel-title')?.textContent).not.toMatch(/pro|premium/i);
    }
  });
  it('applies framework selections only to supported source panels', async () => {
    const store = await import('@/services/analysis-framework-store');
    const framework = store.loadFrameworkLibrary()[0]!;
    store.setActiveFrameworkForPanel('daily-market-brief', framework.id);
    store.setActiveFrameworkForPanel('market-implications', framework.id);
    expect(store.getActiveFrameworkForPanel('daily-market-brief')?.id).toBe(framework.id);
    expect(store.getActiveFrameworkForPanel('market-implications')).toBeNull();
  });
  it('preserves World Monitor premium behavior', () => {
    brand.enabled = false;
    for (const key of restored) {
      const config = getEffectivePanelConfig(key, 'full');
      expect(config.premium).toBe('locked');
      expect(hasPanelDataAccess(key)).toBe(false);
    }
    const panel = new Panel({ id: 'stock-analysis', title: 'Premium Stock Analysis', premium: 'locked' });
    panels.push(panel);
    expect(panel.getElement().querySelector('.panel-pro-badge')).not.toBeNull();
  });
});
