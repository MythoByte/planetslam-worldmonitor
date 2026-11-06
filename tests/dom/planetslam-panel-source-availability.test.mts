import { afterEach, describe, expect, it, vi } from 'vitest';
const brand = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/config/brand', () => ({ get IS_PLANETSLAM() { return brand.enabled; } }));

const { Panel } = await import('@/components/Panel');
const { dataFreshness } = await import('@/services/data-freshness');
const { isPanelSourceUnavailable, hasNoWorkingPanelSource } = await import('@/services/panel-source-availability');

class SourcePanel extends Panel {
  badge(state: 'live' | 'cached' | 'unavailable') { this.setDataBadge(state); }
  success() { this.setContentNodes(document.createTextNode('No current events')); }
}
const panels: SourcePanel[] = [];
function mount(id = 'source-fixture') {
  const panel = new SourcePanel({ id, title: id });
  document.body.append(panel.getElement());
  panels.push(panel);
  return panel;
}
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  brand.enabled = true;
  vi.useRealTimers();
});

describe('PlanetSlam modules with unavailable sources', () => {
  it('hides a failed request while retries remain eligible, then restores successful empty results', () => {
    vi.useFakeTimers();
    const panel = mount();
    const retry = vi.fn();
    panel.showError('Provider is not configured', retry, 1);
    expect(isPanelSourceUnavailable('source-fixture')).toBe(true);
    expect(panel.getElement().classList.contains('panel-source-unavailable')).toBe(true);
    expect(panel.isNearViewport()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(retry).toHaveBeenCalledOnce();
    panel.showLoading('Retrying');
    expect(isPanelSourceUnavailable('source-fixture')).toBe(true);
    panel.success();
    expect(isPanelSourceUnavailable('source-fixture')).toBe(false);
    expect(panel.getElement().classList.contains('panel-source-unavailable')).toBe(false);
  });

  it('hides missing configuration and retains the saved user-hidden state on recovery', () => {
    const panel = mount();
    panel.showConfigError('Missing upstream API key');
    expect(isPanelSourceUnavailable('source-fixture')).toBe(true);
    panel.hide();
    expect(panel.isNearViewport()).toBe(false);
    panel.success();
    expect(isPanelSourceUnavailable('source-fixture')).toBe(false);
    expect(panel.getElement().classList.contains('hidden')).toBe(true);
  });

  it('does not reveal a failed badge merely because unrelated content was repainted', () => {
    const panel = mount();
    panel.badge('unavailable');
    panel.success();
    expect(isPanelSourceUnavailable('source-fixture')).toBe(true);
    panel.badge('cached');
    expect(isPanelSourceUnavailable('source-fixture')).toBe(false);
  });

  it('uses independent source health to hide and restore a module', () => {
    const panel = mount('internet-disruptions');
    dataFreshness.recordSeedHealth([{ sourceId: 'outages', status: 'EMPTY_DATA', records: 0 }]);
    expect(isPanelSourceUnavailable('internet-disruptions')).toBe(true);
    dataFreshness.recordSeedHealth([{ sourceId: 'outages', status: 'OK', records: 0, seedAgeMin: 0 }]);
    expect(isPanelSourceUnavailable('internet-disruptions')).toBe(false);
    expect(panel.getElement().classList.contains('panel-source-unavailable')).toBe(false);
  });

  it('retains unknown sources, working fallbacks, and stale usable data', () => {
    expect(hasNoWorkingPanelSource(null)).toBe(false);
    for (const status of ['fresh', 'stale', 'very_stale'] as const) {
      expect(hasNoWorkingPanelSource({ sources: [{ status: 'error' }, { status }] } as never)).toBe(false);
    }
    expect(hasNoWorkingPanelSource({ sources: [{ status: 'disabled' }, { status: 'no_data' }] } as never)).toBe(true);
  });

  it('cleans up availability when a module is destroyed', () => {
    const panel = mount();
    panel.showConfigError('Missing key');
    panel.destroy();
    expect(isPanelSourceUnavailable('source-fixture')).toBe(false);
  });

  it('preserves upstream World Monitor error visibility', () => {
    brand.enabled = false;
    const panel = mount();
    panel.showError('Provider unavailable');
    expect(isPanelSourceUnavailable('source-fixture')).toBe(false);
    expect(panel.getElement().classList.contains('panel-source-unavailable')).toBe(false);
    expect(panel.getElement().querySelector('.panel-error-state')).not.toBeNull();
  });
});
