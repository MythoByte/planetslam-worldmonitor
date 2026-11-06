import { Panel } from './Panel';
import { fetchSpaceDataset } from '@/services/space';
import { getSpacePreferences, isSpaceWatched, toggleSpaceWatch, subscribeSpacePreferences, SPACE_WATCH_LIMIT } from '@/services/space-personalization';
import { safeHtml, joinSafeHtml, safeUrlAttr } from '@/utils/sanitize';
import type { MissionsData, SpaceEnvelope, SpaceMissionEvent } from '@/types/space';
import '@/styles/space.css';

export function missionScheduleLabel(item: SpaceMissionEvent): string {
  if (!Number.isFinite(item.date) || item.date <= 0) return 'Schedule pending';
  const date = new Date(item.date); const iso = date.toISOString();
  switch (item.datePrecision) {
    case 'year': return `${date.getUTCFullYear()} · year estimate`;
    case 'quarter': return `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1} · quarter estimate`;
    case 'month': return `${iso.slice(0, 7)} · month estimate`;
    case 'day': return `${iso.slice(0, 10)} · day estimate`;
    case 'hour': return `${iso.slice(0, 13).replace('T', ' ')}:00 UTC · hour estimate`;
    case 'minute': return `${iso.slice(0, 16).replace('T', ' ')} UTC · minute estimate`;
    case 'second': return `${iso.slice(0, 19).replace('T', ' ')} UTC · second estimate`;
    default: return `${iso.slice(0, 10)} · precision unknown`;
  }
}

export class SpaceMissionsPanel extends Panel {
  private latest: SpaceEnvelope<MissionsData> | null = null;
  private kind = 'all';
  private loading = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribePreferences: () => void;

  constructor() {
    super({ id: 'space-missions', title: 'Mission Events', className: 'space-panel', defaultRowSpan: 2 });
    this.unsubscribePreferences = subscribeSpacePreferences(() => this.render());
    this.content.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-mission-watch], [data-mission-retry]');
      if (target?.dataset.missionWatch) toggleSpaceWatch('mission', target.dataset.missionWatch);
      if (target?.hasAttribute('data-mission-retry')) void this.fetchData(true);
    }, { signal: this.signal });
    this.content.addEventListener('change', event => {
      const select = event.target as HTMLSelectElement;
      if (!select.matches('[data-mission-kind]')) return;
      this.kind = select.value; this.render();
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
    this.loading = true;
    try {
      const latest = await fetchSpaceDataset<MissionsData>('missions', force);
      if (!this.signal.aborted) this.latest = latest;
    } catch {
      this.latest = { dataset: 'missions', status: 'unavailable', provider: 'Launch Library 2', sourceUrl: '', fetchedAt: null, observedAt: null, expiresAt: null, data: null };
    } finally { this.loading = false; }
    if (!this.signal.aborted) this.render();
  }

  private render(): void {
    const latest = this.latest;
    const usable = latest?.data && latest.status !== 'unavailable' && (latest.expiresAt === null || latest.expiresAt > Date.now());
    const items = usable ? latest.data!.items.filter(item => this.kind === 'all' || item.kind === this.kind) : [];
    const watchlist = getSpacePreferences().missionWatchlist;
    this.setSafeContentImmediate(safeHtml`<div class="space-body" data-missions-status="${!latest ? 'loading' : !usable ? 'unavailable' : latest.status}"><p class="space-note">Dockings, spacewalks, landings, briefings, and other mission events. Provider estimates can change; date precision is preserved.</p><div class="space-provenance"><span>${!latest ? 'Loading mission events…' : !usable ? 'Mission events unavailable' : latest.status === 'stale' ? 'Stale · last known mission events' : 'Updated cached events'}</span>${latest?.sourceUrl ? safeHtml`<a href="${safeUrlAttr(latest.sourceUrl)}" target="_blank" rel="noopener noreferrer">${latest.provider}</a>` : ''}<button type="button" data-mission-retry>Refresh events</button></div><label class="space-filter">Event type<select data-mission-kind aria-label="Mission event type">${joinSafeHtml([['all', 'All mission events'], ['spacewalk', 'Spacewalks'], ['docking', 'Dockings'], ['landing', 'Landings'], ['briefing', 'Briefings'], ['other', 'Other events']].map(([value, label]) => safeHtml`<option value="${value}" ${this.kind === value ? safeHtml`selected` : ''}>${label}</option>`))}</select></label>${latest?.message ? safeHtml`<p class="space-note">${latest.message}</p>` : ''}${items.length ? joinSafeHtml(items.slice(0, 40).map(item => safeHtml`<article class="space-card" data-mission-id="${item.id}"><div class="space-eyebrow">${item.type} · ${item.status}</div><a class="space-headline" href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">${item.name}</a><p>${missionScheduleLabel(item)}</p><small>${item.datePrecisionDescription}</small><p>${item.location}</p><p>${item.description.slice(0, 360)}</p><button type="button" data-mission-watch="${item.id}" aria-pressed="${isSpaceWatched('mission', item.id)}" ${!isSpaceWatched('mission', item.id) && watchlist.length >= SPACE_WATCH_LIMIT ? safeHtml`disabled` : ''}>${isSpaceWatched('mission', item.id) ? '★ Watching event' : '☆ Watch event'}</button>${item.webcastUrl ? safeHtml` <a href="${safeUrlAttr(item.webcastUrl)}" target="_blank" rel="noopener noreferrer">Watch at source ↗</a>` : ''}</article>`)) : safeHtml`<p class="space-empty">${!latest ? 'Loading…' : !usable ? 'No current event data is available. This does not mean that no missions are scheduled.' : 'No matching events in this cached feed.'}</p>`}${usable && latest.data?.truncated ? safeHtml`<p class="space-note">The provider feed is limited; additional mission events may not appear.</p>` : ''}</div>`, () => {
      const select = this.content.querySelector<HTMLSelectElement>('[data-mission-kind]'); if (select) select.value = this.kind;
    });
  }

  override destroy(): void {
    if (this.timer) clearInterval(this.timer); this.unsubscribePreferences(); super.destroy();
  }
}
