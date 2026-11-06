import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTestI18n } from './helpers/i18n.mts';
import type { SpaceBriefData, SpaceEnvelope } from '@/types/space';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/services/space', () => ({ fetchSpaceDataset: mocks.fetch }));
import { SpaceBriefPanel } from '@/components/SpaceBriefPanel';

let panel: SpaceBriefPanel | null = null;
function fixture(): SpaceEnvelope<SpaceBriefData> {
  const now = Date.now();
  return { dataset: 'brief', status: 'fresh', provider: 'PlanetSlam Space', sourceUrl: 'https://example.com/space', fetchedAt: now,
    observedAt: now, expiresAt: now + 86400_000, data: {
      date: new Date(now).toISOString().slice(0, 10), generatedAt: now, mode: 'ai', model: 'synthetic-model', title: 'Synthetic daily brief',
      items: [{ id: 'section1', heading: 'Science <script>', summary: 'Synthetic source-backed summary <img src=x onerror=alert(1)>', sourceIds: ['source1'] }],
      sources: [{ id: 'source1', dataset: 'news', title: 'Original science story', url: 'https://example.com/science', fetchedAt: now, observedAt: now - 60000, status: 'fresh', expiresAt: now + 86400_000, freshUntil: now + 3600_000 }],
      coverage: [{ dataset: 'news', status: 'fresh', fetchedAt: now, observedAt: now - 60000, itemCount: 1, expiresAt: now + 86400_000, freshUntil: now + 3600_000 }, { dataset: 'neo', status: 'unavailable', fetchedAt: null, observedAt: null, itemCount: 0, expiresAt: null, freshUntil: null }],
      limitations: ['NEO input unavailable; this brief does not assess impact risk.'],
    } };
}
function mount(): SpaceBriefPanel {
  panel = new SpaceBriefPanel(); document.body.append(panel.getElement()); panel.notifyConnected(); return panel;
}
beforeAll(initTestI18n);
beforeEach(() => { mocks.fetch.mockReset(); mocks.fetch.mockResolvedValue(fixture()); });
afterEach(() => { panel?.destroy(); panel = null; document.body.replaceChildren(); });

describe('Space Daily Brief panel', () => {
  it('shows explicit AI labeling, escaped source-backed sections and original citation links', async () => {
    const element = mount().getElement();
    await vi.waitFor(() => expect(element.querySelector('[data-brief-status]')?.getAttribute('data-brief-status')).toBe('fresh'));
    expect(element.textContent).toContain('AI-generated synthesis');
    expect(element.textContent).toContain('synthetic-model');
    expect(element.textContent).toContain('Science <script>');
    expect(element.querySelector('script, img')).toBeNull();
    const citation = element.querySelector<HTMLAnchorElement>('[data-brief-citation="source1"]')!;
    expect(citation.href).toBe('https://example.com/science');
    expect(citation.getAttribute('aria-label')).toBe('Source 1: Original science story');
    expect(citation.rel).toContain('noopener');
    expect(element.querySelector('[data-brief-coverage="neo"]')?.textContent).toContain('Excluded from this brief');
    expect(element.textContent).toContain('does not assess impact risk');
    const sources = element.querySelector<HTMLDetailsElement>('[data-brief-detail="sources"]')!;
    sources.open = true;
    element.querySelector<HTMLButtonElement>('[data-brief-retry]')!.click();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenLastCalledWith('brief', true));
    await vi.waitFor(() => expect(element.querySelector<HTMLButtonElement>('[data-brief-retry]')!.disabled).toBe(false));
    expect(element.querySelector<HTMLDetailsElement>('[data-brief-detail="sources"]')!.open).toBe(true);
    expect(mocks.fetch.mock.calls.every(([dataset]) => dataset === 'brief')).toBe(true);
  });

  it('labels deterministic fallback as a source summary rather than AI', async () => {
    const value = fixture(); value.data!.mode = 'source-summary'; value.data!.model = null;
    mocks.fetch.mockResolvedValue(value);
    const element = mount().getElement();
    await vi.waitFor(() => expect(element.textContent).toContain('Source summary · not AI-generated'));
    expect(element.textContent).not.toContain('Model:');
    expect(element.textContent).toContain('Refresh reads the saved brief');
  });

  it('reports stale editions and hides expired brief text', async () => {
    const value = fixture(); value.status = 'stale'; mocks.fetch.mockResolvedValue(value);
    const instance = mount();
    await vi.waitFor(() => expect(instance.getElement().textContent).toContain('Stale · last available brief'));
    value.expiresAt = Date.now() - 1; mocks.fetch.mockResolvedValue(value); await instance.fetchData(true);
    expect(instance.getElement().querySelector('[data-brief-status]')?.getAttribute('data-brief-status')).toBe('unavailable');
    expect(instance.getElement().textContent).not.toContain('Synthetic source-backed summary');
    expect(instance.getElement().textContent).toContain('does not mean that no launches, events, or hazards exist');
  });

  it('recovers after a cache read failure without generating a brief in the browser', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('Unavailable'));
    const instance = mount();
    await vi.waitFor(() => expect(instance.getElement().querySelector('[data-brief-status]')?.getAttribute('data-brief-status')).toBe('unavailable'));
    await instance.fetchData(true);
    expect(instance.getElement().querySelector('[data-brief-status]')?.getAttribute('data-brief-status')).toBe('fresh');
    expect(mocks.fetch.mock.calls).toEqual([['brief', false], ['brief', true]]);
  });

  it('ignores a completed request after destruction', async () => {
    let resolve!: (value: SpaceEnvelope<SpaceBriefData>) => void;
    mocks.fetch.mockImplementation(() => new Promise<SpaceEnvelope<SpaceBriefData>>(done => { resolve = done; }));
    const instance = mount(); const element = instance.getElement();
    instance.destroy(); resolve(fixture());
    await Promise.resolve(); await Promise.resolve();
    expect(element.textContent).not.toContain('Synthetic source-backed summary');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
