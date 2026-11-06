import { Panel } from './Panel';
import { fetchCyberDataset, subscribeCyberDataset } from '@/services/cyber-dashboard';
import { filterCyberIncidents, getCyberFilters, setCyberFilters, subscribeCyberFilters, DEFAULT_CYBER_FILTERS } from '@/services/cyber-explore';
import { cyberExploreControls, changeCyberFilter } from './cyber-explore-controls';
import { CYBER_MARKER_EVENT } from './cyber-map-interaction';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';
import type { CyberEnvelope, CyberIncidentData, CyberInfrastructureData, CyberIncident } from '@/types/cyber-dashboard';
import '@/styles/cyber.css';
const time = (at: number | null) => at && Number.isFinite(at) ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Not supplied';
export class CyberIncidentsPanel extends Panel {
  private incidents: CyberEnvelope<CyberIncidentData> | null = null;
  private infrastructure: CyberEnvelope<CyberInfrastructureData> | null = null;
  private stopped = false;
  private loading = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private selected = '';
  private unsubscribe: () => void;
  private unsubscribeData: () => void;
  private readonly onMarker = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.kind === 'incident' && typeof detail.id === 'string') { this.selected = detail.id; this.renderLatest(); }
  };
  constructor() {
    super({ id: 'cyber-incidents', title: 'Reported Cyber Incidents', className: 'cyber-panel', defaultRowSpan: 3,
      infoTooltip: 'Public recent-record sample from UMD GoTech. Monthly research updates; reporting is not independent confirmation. Missing locations remain unmapped.' });
    this.unsubscribeData = subscribeCyberDataset(value => {
      if (value.dataset === 'incidents') this.incidents = value as CyberEnvelope<CyberIncidentData>;
      else if (value.dataset === 'infrastructure') this.infrastructure = value as CyberEnvelope<CyberInfrastructureData>;
      else return;
      if (!this.stopped) this.renderLatest();
    });
    this.unsubscribe = subscribeCyberFilters(() => this.renderLatest());
    window.addEventListener(CYBER_MARKER_EVENT, this.onMarker);
    this.content.addEventListener('change', event => { changeCyberFilter(event); }, { signal: this.signal });
    this.content.addEventListener('click', event => {
      const el = (event.target as HTMLElement).closest<HTMLElement>('[data-cyber-retry], [data-cyber-reset], [data-cyber-show-map], [data-cyber-locate]');
      if (!el) return;
      if (el.hasAttribute('data-cyber-retry')) void this.fetchData(true);
      if (el.hasAttribute('data-cyber-reset')) setCyberFilters(DEFAULT_CYBER_FILTERS);
      if (el.hasAttribute('data-cyber-show-map') || el.dataset.cyberLocate) window.dispatchEvent(new Event('planetslam:cyber-show-map'));
      if (el.dataset.cyberLocate) window.dispatchEvent(new CustomEvent('planetslam:cyber-focus', { detail: { kind: 'incident', id: el.dataset.cyberLocate } }));
    }, { signal: this.signal });
    this.runWhenConnected(() => {
      void this.fetchData();
      this.timer = setInterval(() => { if (this.canHostLiveMedia() && document.visibilityState !== 'hidden') void this.fetchData(); }, 60_000);
    });
  }
  async fetchData(force = false): Promise<void> {
    if (this.loading || this.stopped) return;
    this.loading = true;
    const [incidents, infrastructure] = await Promise.allSettled([
      fetchCyberDataset<CyberIncidentData>('incidents', force), fetchCyberDataset<CyberInfrastructureData>('infrastructure', force),
    ]);
    if (!this.stopped) {
      this.incidents = incidents.status === 'fulfilled' ? incidents.value : null;
      this.infrastructure = infrastructure.status === 'fulfilled' ? infrastructure.value : null;
      this.renderLatest();
    }
    this.loading = false;
  }
  private card(i: CyberIncident): SafeHtml {
    return safeHtml`<article class="cyber-card" data-cyber-incident="${i.id}"><div class="cyber-eyebrow">${i.countryCode} · ${i.country} · ${i.sector}</div><a class="cyber-headline" href="${safeUrlAttr(i.url)}" target="_blank" rel="noopener noreferrer">${i.organization} ↗</a><p><strong>${i.category}</strong> · ${i.verification === 'claim-reported' ? 'Claim in reporting · unverified' : 'Reported · research-coded, not independently verified'}</p><p>${i.description}</p><p class="cyber-note">${i.latitude !== null ? 'Map: approximate country location; not a victim address or attacker location.' : 'Country location unavailable; retained in the tracker, omitted from the map.'}</p>${i.latitude !== null ? safeHtml`<button type="button" data-cyber-locate="${i.id}">Locate on map</button>` : ''}<details class="cyber-timeline" ${this.selected === i.id ? safeHtml`open` : ''}><summary>Incident timeline & sources</summary><ol><li>Provider event date: ${time(i.eventAt)} (may be estimated)</li><li>Original report published: ${time(i.reportedAt)}</li>${i.updatedAt ? safeHtml`<li>Database record updated: ${time(i.updatedAt)}</li>` : safeHtml`<li>No provider revision timestamp supplied.</li>`}</ol>${i.changeLog ? safeHtml`<p>Provider change log: ${i.changeLog}</p>` : ''}${i.reportUrl ? safeHtml`<a href="${safeUrlAttr(i.reportUrl)}" target="_blank" rel="noopener noreferrer">Original reporting ↗</a>` : safeHtml`<p class="cyber-note">Original reporting link not supplied as a usable HTTPS URL.</p>`}</details></article>`;
  }
  private renderLatest(): void {
    const e = this.incidents;
    const all = e?.status !== 'unavailable' ? e?.data?.items || [] : [];
    const items = filterCyberIncidents(all, getCyberFilters());
    const infra = this.infrastructure?.status !== 'unavailable' ? this.infrastructure?.data?.items || [] : [];
    this.setSafeContentImmediate(safeHtml`<div class="cyber-body"><div class="cyber-provenance" data-cyber-status="${e?.status || 'unavailable'}"><strong>${e?.status === 'fresh' ? 'Updated' : e?.status === 'stale' ? 'Delayed · last known data' : 'Unavailable'}</strong><a href="https://cybereventsdatabase.org/" target="_blank" rel="noopener noreferrer">UMD GoTech ↗</a><span>Fetched ${time(e?.fetchedAt ?? null)}</span><span>Latest report ${time(e?.observedAt ?? null)}</span></div><p class="cyber-note">Monthly research updates · public recent-record sample. This is not a live attack counter or complete global coverage. Filters also update the map; sector applies to incidents only.</p>${cyberExploreControls(all, infra)}<button type="button" data-cyber-show-map>Show Cyber map</button><p class="cyber-note">${items.length} matching records of ${all.length} available · ${items.filter(i => i.latitude === null).length} without a mapped country.</p>${!e?.data || e.status === 'unavailable' ? safeHtml`<div class="cyber-empty"><strong>Incident data temporarily unavailable</strong><p>${e?.message || 'The shared incident service could not be reached. This does not imply no incidents.'}</p><button type="button" data-cyber-retry>Retry</button></div>` : items.length ? joinSafeHtml(items.map(i => this.card(i))) : safeHtml`<p class="cyber-empty">No records match these filters in the available sample. Broaden the reported period to see older reports.</p>`}</div>`);
  }
  override destroy(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); this.unsubscribe(); this.unsubscribeData(); window.removeEventListener(CYBER_MARKER_EVENT, this.onMarker); super.destroy(); }
}
