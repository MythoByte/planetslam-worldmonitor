import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { fetchCyberDataset, subscribeCyberDataset } from '@/services/cyber-dashboard';
import { cyberMapSnapshot, defangCyberIndicator, getCyberFilters, setCyberFilters, subscribeCyberFilters, DEFAULT_CYBER_FILTERS } from '@/services/cyber-explore';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import type { CyberEnvelope, CyberIncidentData, CyberInfrastructureData } from '@/types/cyber-dashboard';
import { normalizeCyberMap, type CyberMapSnapshot } from '@/types/cyber-map';
import { safeHtml, safeUrlAttr, joinSafeHtml } from '@/utils/sanitize';
import { cyberExploreControls, changeCyberFilter } from './cyber-explore-controls';
import { CYBER_MARKER_EVENT } from './cyber-map-interaction';
import '@/styles/cyber.css';
export class CyberMapOverlay {
  private readonly controls = document.createElement('details');
  private readonly abort = new AbortController();
  private readonly observer: MutationObserver;
  private readonly poll: SmartPollLoopHandle;
  private unsubscribe: () => void;
  private unsubscribeData: () => void;
  private lastCountry = 'all';
  private incidents: CyberEnvelope<CyberIncidentData> | null = null;
  private infrastructure: CyberEnvelope<CyberInfrastructureData> | null = null;
  private selected: { kind: string; id: string } | null = null;
  private destroyed = false;
  constructor(private container: HTMLElement, private paint: (snapshot: CyberMapSnapshot) => void, private center: (lat: number, lon: number) => void) {
    this.controls.className = 'cyber-map-controls'; this.controls.dataset.testid = 'cyber-map-controls';
    for (const event of ['pointerdown', 'wheel']) this.controls.addEventListener(event, e => e.stopPropagation(), { signal: this.abort.signal });
    this.controls.addEventListener('change', e => {
      const input = e.target as HTMLSelectElement;
      if (input.matches('[data-cyber-inspect]')) {
        const colon = input.value.indexOf(':');
        window.dispatchEvent(new CustomEvent('planetslam:cyber-focus', { detail: { kind: input.value.slice(0, colon), id: input.value.slice(colon + 1) } }));
      } else changeCyberFilter(e);
    }, { signal: this.abort.signal });
    this.controls.addEventListener('click', event => {
      event.stopPropagation();
      if ((event.target as HTMLElement).closest('[data-cyber-reset]')) setCyberFilters(DEFAULT_CYBER_FILTERS);
    }, { signal: this.abort.signal });
    const select = (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (d && typeof d.id === 'string' && ['incident', 'infrastructure'].includes(d.kind)) {
        this.selected = { kind: d.kind, id: d.id };
        const marker = this.snapshot().markers.find(m => m.kind === d.kind && m.id === d.id);
        if (!marker) { this.selected = null; return; }
        this.controls.open = true;
        if (event.type === 'planetslam:cyber-focus') this.center(marker.latitude, marker.longitude);
        this.render();
      }
    };
    window.addEventListener(CYBER_MARKER_EVENT, select, { signal: this.abort.signal });
    window.addEventListener('planetslam:cyber-focus', select, { signal: this.abort.signal });
    this.observer = new MutationObserver(() => this.attach()); this.observer.observe(container, { childList: true });
    this.unsubscribeData = subscribeCyberDataset(value => {
      if (value.dataset === 'incidents') this.incidents = value as CyberEnvelope<CyberIncidentData>;
      else if (value.dataset === 'infrastructure') this.infrastructure = value as CyberEnvelope<CyberInfrastructureData>;
      else return;
      this.render();
    });
    this.unsubscribe = subscribeCyberFilters(() => this.render());
    this.render(); this.attach();
    this.poll = startSmartPollLoop(() => this.refresh(), { intervalMs: 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true });
  }
  private attach(): void { if (!this.destroyed && this.controls.parentElement !== this.container) this.container.append(this.controls); }
  private records() { return { incidents: this.incidents?.status !== 'unavailable' ? this.incidents?.data?.items || [] : [], infrastructure: this.infrastructure?.status !== 'unavailable' ? this.infrastructure?.data?.items || [] : [] }; }
  private snapshot(): CyberMapSnapshot { const r = this.records(); return normalizeCyberMap(cyberMapSnapshot(r.incidents, r.infrastructure)); }
  private async refresh(): Promise<void> {
    const [a, b] = await Promise.allSettled([fetchCyberDataset<CyberIncidentData>('incidents'), fetchCyberDataset<CyberInfrastructureData>('infrastructure')]);
    if (this.destroyed) return;
    this.incidents = a.status === 'fulfilled' ? a.value : null; this.infrastructure = b.status === 'fulfilled' ? b.value : null; this.render();
  }
  private render(): void {
    if (this.destroyed) return;
    const r = this.records(), snapshot = this.snapshot();
    const i = snapshot.markers.filter(m => m.kind === 'incident').length, n = snapshot.markers.filter(m => m.kind === 'infrastructure').length;
    const country = getCyberFilters().country;
    if (country !== this.lastCountry) {
      this.lastCountry = country;
      const first = country !== 'all' ? snapshot.markers.find(m => m.country === country || (m.kind === 'incident'
        ? r.incidents.find(i => i.id === m.id)?.countryCode === country : r.infrastructure.find(i => i.id === m.id)?.countryCode === country)) : null;
      if (first) this.center(first.latitude, first.longitude);
    }
    const selected = this.selected;
    if (selected && !snapshot.markers.some(m => m.id === selected.id && m.kind === selected.kind)) this.selected = null;
    const incident = this.selected?.kind === 'incident' ? r.incidents.find(x => x.id === this.selected?.id) : null;
    const infrastructure = this.selected?.kind === 'infrastructure' ? r.infrastructure.find(x => x.id === this.selected?.id) : null;
    const report = incident || infrastructure;
    const label = incident?.organization || (infrastructure ? defangCyberIndicator(infrastructure.indicator) : '');
    const selection = report ? safeHtml`<section class="cyber-map-detail" data-testid="cyber-map-detail"><strong>${label}</strong><p>${incident ? 'Reported incident · approximate country location' : 'Infrastructure indicator · approximate geolocation'} · ${report.country} · ${report.category}</p><a href="${safeUrlAttr(report.url)}" target="_blank" rel="noopener noreferrer">${incident ? 'Incident source record' : 'Indicator feed source'} ↗</a>${incident?.reportUrl ? safeHtml`<a href="${safeUrlAttr(incident.reportUrl)}" target="_blank" rel="noopener noreferrer">Original reporting ↗</a>` : ''}</section>` : safeHtml``;
    setTrustedHtml(this.controls, trustedHtml(safeHtml`<summary>Cyber map · ${i} reports / ${n} infrastructure shown</summary><p class="cyber-note">Amber: reported victim country. Violet: infrastructure geolocation. Neither identifies the attacker. Country positions can overlap.</p>${selection}<label class="cyber-map-inspect">Inspect map marker<select data-cyber-inspect aria-label="Inspect map marker"><option value="">Choose a marker…</option>${joinSafeHtml(snapshot.markers.map(m => safeHtml`<option value="${m.kind}:${m.id}" ${this.selected?.id === m.id && this.selected?.kind === m.kind ? safeHtml`selected` : ''}>${m.kind === 'incident' ? 'Report' : 'Infrastructure'}: ${m.label}</option>`))}</select></label>${cyberExploreControls(r.incidents, r.infrastructure, true)}<p class="cyber-note" data-testid="cyber-map-status">Incidents: ${this.incidents?.status || 'unavailable'} · Infrastructure: ${this.infrastructure?.status || 'unavailable'}</p><p class="cyber-note">${r.incidents.length - r.incidents.filter(x => x.latitude !== null).length} incident records unlocated. ${r.infrastructure.filter(x => x.latitude === null).length} infrastructure records unlocated. Infrastructure drawing capped at 500 of ${this.infrastructure?.data?.totalCount ?? 0} source indicators${this.infrastructure?.data?.truncated ? ' (source projection truncated)' : ''}. The mixed IOC snapshot does not report completeness of each upstream feed.</p>`.toString(), 'All fields are escaped with safeHtml; source URLs pass safeUrlAttr.'));
    this.paint(snapshot);
  }
  destroy(): void { this.destroyed = true; this.abort.abort(); this.poll.stop(); this.unsubscribe(); this.unsubscribeData(); this.observer.disconnect(); this.controls.remove(); this.paint({ markers: [] }); }
}
