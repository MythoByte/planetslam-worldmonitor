import { Panel } from './Panel';
import { fetchSpaceDataset } from '@/services/space';
import { safeHtml, joinSafeHtml, safeUrlAttr } from '@/utils/sanitize';
import type { SpaceBriefData, SpaceDataset, SpaceEnvelope } from '@/types/space';
import '@/styles/space.css';

const DATASET_LABELS: Partial<Record<SpaceDataset, string>> = {
  apod: 'NASA Picture of the Day', news: 'Space news', launches: 'Launches', weather: 'Space weather',
  aurora: 'Aurora', solar: 'Sun images', events: 'Solar events', neo: 'Near-Earth Objects',
  orbits: 'Satellites', missions: 'Mission events',
};

function utc(value: number | null): string {
  return value !== null && Number.isFinite(value) && Number.isFinite(new Date(value).getTime())
    ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Not available';
}

export class SpaceBriefPanel extends Panel {
  private latest: SpaceEnvelope<SpaceBriefData> | null = null;
  private loading = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'space-brief', title: 'Space Daily Brief', className: 'space-panel', defaultRowSpan: 3 });
    this.content.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-brief-retry]')) void this.fetchData(true);
    }, { signal: this.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') { this.render(); void this.fetchData(); }
    }, { signal: this.signal });
    this.render();
    this.runWhenConnected(() => {
      void this.fetchData();
      this.timer = setInterval(() => {
        if (document.visibilityState !== 'hidden') { this.render(); void this.fetchData(); }
      }, 60_000);
    });
  }

  public async fetchData(force = false): Promise<void> {
    if (this.loading || this.signal.aborted) return;
    this.loading = true; this.render();
    try {
      const latest = await fetchSpaceDataset<SpaceBriefData>('brief', force);
      if (!this.signal.aborted) this.latest = latest;
    } catch {
      if (!this.signal.aborted) this.latest = { dataset: 'brief', status: 'unavailable', provider: 'PlanetSlam Space', sourceUrl: '', fetchedAt: null, observedAt: null, expiresAt: null, data: null };
    } finally { this.loading = false; }
    if (!this.signal.aborted) this.render();
  }

  private render(): void {
    const latest = this.latest;
    const usable = latest?.data && latest.status !== 'unavailable' && latest.expiresAt !== null && latest.expiresAt > Date.now();
    const brief = usable ? latest.data! : null;
    const details = [...this.content.querySelectorAll<HTMLDetailsElement>('details[data-brief-detail]')]
      .filter(detail => detail.open).map(detail => detail.dataset.briefDetail);
    const sourceNumbers = new Map(brief?.sources.map((source, index) => [source.id, index + 1]));
    this.setSafeContentImmediate(safeHtml`<div class="space-body" data-brief-status="${!latest ? 'loading' : !brief ? 'unavailable' : latest.status}" aria-busy="${this.loading}">
      <div class="space-provenance"><span role="status">${!latest ? 'Loading daily brief…' : !brief ? 'Daily brief unavailable' : latest.status === 'stale' ? 'Stale · last available brief' : 'Shared daily brief'}</span><button type="button" data-brief-retry ${this.loading ? safeHtml`disabled` : ''}>Refresh brief</button></div>
      <p class="space-note">Prepared centrally from cached Space sources. Refresh reads the saved brief; it does not request a new AI generation. Observer location and watchlists are not included.</p>
      ${latest?.message ? safeHtml`<p class="space-note">${latest.message}</p>` : ''}
      ${brief ? safeHtml`<header class="space-brief-header"><h3>${brief.title}</h3><p>${brief.date} UTC edition · Generated ${utc(brief.generatedAt)}</p><strong data-brief-mode="${brief.mode}">${brief.mode === 'ai' ? 'AI-generated synthesis' : 'Source summary · not AI-generated'}</strong>${brief.mode === 'ai' && brief.model ? safeHtml`<small>Model: ${brief.model}</small>` : ''}</header>
        <p class="space-note">A summary of the available source snapshots, not a complete account of space activity. Provider schedules and conditions can change; follow source links for details.</p>
        ${brief.items.length ? joinSafeHtml(brief.items.map(item => safeHtml`<article class="space-card space-brief-section" data-brief-section="${item.id}"><h4>${item.heading}</h4><p>${item.summary}</p><nav class="space-brief-citations" aria-label="Sources for ${item.heading}">${joinSafeHtml(item.sourceIds.flatMap(id => {
          const source = brief.sources.find(candidate => candidate.id === id);
          return source ? [safeHtml`<a href="${safeUrlAttr(source.url)}" target="_blank" rel="noopener noreferrer" data-brief-citation="${source.id}" aria-label="Source ${sourceNumbers.get(id)}: ${source.title}">[${sourceNumbers.get(id)}] ${source.title} ↗</a>`] : [];
        }))}</nav></article>`)) : safeHtml`<p class="space-empty">No source-backed sections are available in this brief.</p>`}
        <details data-brief-detail="sources"><summary>Sources (${brief.sources.length})</summary><ol class="space-brief-sources">${joinSafeHtml(brief.sources.map(source => safeHtml`<li data-brief-source="${source.id}"><a href="${safeUrlAttr(source.url)}" target="_blank" rel="noopener noreferrer">${source.title} ↗</a><small>${DATASET_LABELS[source.dataset] || source.dataset} · ${source.status} · Fetched ${utc(source.fetchedAt)} · Expires ${utc(source.expiresAt)}${source.observedAt === null ? '' : ` · Observed / published ${utc(source.observedAt)}`}</small></li>`))}</ol></details>
        <details data-brief-detail="coverage" open><summary>Source coverage (${brief.coverage.filter(item => item.status !== 'unavailable').length}/${brief.coverage.length} source snapshots available)</summary><ul class="space-brief-coverage">${joinSafeHtml(brief.coverage.map(item => safeHtml`<li data-brief-coverage="${item.dataset}"><span>${DATASET_LABELS[item.dataset] || item.dataset}</span><strong>${item.status}</strong><small>${item.status === 'unavailable' ? 'Excluded from this brief' : `Fetched ${utc(item.fetchedAt)} · ${item.itemCount} cached records`}</small></li>`))}</ul></details>
        ${brief.limitations.length ? safeHtml`<aside class="space-note" aria-label="Brief limitations"><h4>Limits and gaps</h4><ul>${joinSafeHtml(brief.limitations.map(item => safeHtml`<li>${item}</li>`))}</ul></aside>` : ''}` : safeHtml`<p class="space-empty">${!latest ? 'Waiting for the shared brief…' : 'No current source-backed daily brief is available. This does not mean that no launches, events, or hazards exist.'}</p><p class="space-note">The Space worker prepares a shared UTC edition from available feeds. Other Space panels remain usable independently.</p>`}
    </div>`, () => {
      for (const detail of this.content.querySelectorAll<HTMLDetailsElement>('details[data-brief-detail]')) {
        if (detail.dataset.briefDetail === 'sources') detail.open = details.includes('sources');
      }
    });
  }

  override destroy(): void {
    if (this.timer) clearInterval(this.timer);
    super.destroy();
  }
}
