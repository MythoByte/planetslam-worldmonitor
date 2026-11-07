import { Panel } from './Panel';
import { fetchCyberDataset, subscribeCyberDataset } from '@/services/cyber-dashboard';
import { getCyberWatchlist, subscribeCyberWatchlist } from '@/services/cyber-watchlist';
import { prioritizeCyber, DEFAULT_PRIORITY_FILTERS, type PriorityFilters } from '@/services/cyber-priorities';
import { safeHtml, safeUrlAttr, joinSafeHtml, type SafeHtml } from '@/utils/sanitize';
import type { CyberEnvelope, CyberKevData, CyberEpssData, CyberCvssData, CyberDataset } from '@/types/cyber-dashboard';
import '@/styles/cyber.css';
const time = (n: number | null) => n ? new Date(n).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Not available';
export class CyberAttentionPanel extends Panel {
  private latest = new Map<string, CyberEnvelope<unknown>>();
  private filters: PriorityFilters = { ...DEFAULT_PRIORITY_FILTERS };
  private limit = 20;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading = false;
  private stopped = false;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeData: () => void;
  constructor() {
    super({ id: 'cyber-attention', title: 'Vulnerability Attention Queue', className: 'cyber-panel', defaultRowSpan: 3,
      infoTooltip: 'CISA known exploitation, FIRST EPSS likelihood, contributor CVSS severity and local watchlist keywords. These signals do not establish exposure of your installed systems.' });
    this.unsubscribe = subscribeCyberWatchlist(() => { this.limit = 20; this.render(); });
    this.unsubscribeData = subscribeCyberDataset(e => { if (['kev', 'epss', 'cvss'].includes(e.dataset)) { this.latest.set(e.dataset, e); this.render(); } });
    this.content.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const key = input.dataset.priorityFilter as keyof PriorityFilters;
      if (!(key in this.filters)) return;
      this.filters = { ...this.filters, [key]: key === 'watched' ? input.checked : input.value };
      if (key === 'vendor') this.filters.product = 'all';
      this.limit = 20; this.render();
    }, { signal: this.signal });
    this.content.addEventListener('click', event => {
      const el = event.target as HTMLElement;
      if (el.closest('[data-priority-reset]')) { this.filters = { ...DEFAULT_PRIORITY_FILTERS }; this.limit = 20; this.render(); }
      if (el.closest('[data-priority-more]')) { this.limit += 20; this.render(); }
      if (el.closest('[data-priority-retry]')) void this.refresh(true);
    }, { signal: this.signal });
    this.runWhenConnected(() => {
      void this.refresh();
      this.timer = setInterval(() => { if (this.canHostLiveMedia() && document.visibilityState !== 'hidden') void this.refresh(); }, 60000);
    });
  }
  private usable<T>(name: string): T | null {
    const e = this.latest.get(name);
    return e && e.status !== 'unavailable' && e.expiresAt !== null && e.expiresAt > Date.now() ? e.data as T : null;
  }
  private async refresh(force = false): Promise<void> {
    if (this.loading || this.stopped) return;
    this.loading = true;
    await Promise.all((['kev', 'epss', 'cvss'] as CyberDataset[]).map(async name => {
      try { const e = await fetchCyberDataset(name, force); if (!this.stopped) this.latest.set(name, e); }
      catch { if (!this.stopped) this.latest.delete(name); }
    }));
    this.loading = false; this.render();
  }
  private select(key: keyof PriorityFilters, label: string, values: string[]): SafeHtml {
    return safeHtml`<label>${label}<select data-priority-filter="${key}" aria-label="${label}"><option value="all">All</option>${joinSafeHtml(values.map(v => safeHtml`<option value="${v}" ${this.filters[key] === v ? safeHtml`selected` : ''}>${v}</option>`))}</select></label>`;
  }
  private render(): void {
    if (this.stopped) return;
    const kev = this.usable<CyberKevData>('kev'), epss = this.usable<CyberEpssData>('epss'), cvss = this.usable<CyberCvssData>('cvss');
    const provenance = joinSafeHtml(['kev', 'epss', 'cvss'].map(name => {
      const e = this.latest.get(name);
      return safeHtml`<div class="cyber-provenance"><strong>${name.toUpperCase()}</strong><span>${e?.status || 'unavailable'}</span>${e ? safeHtml`<a href="${safeUrlAttr(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e.provider} ↗</a>` : ''}<span>Fetched ${time(e?.fetchedAt ?? null)}</span></div>`;
    }));
    let body: SafeHtml;
    if (!kev) body = safeHtml`<p class="cyber-empty">${this.loading ? 'Loading vulnerability priorities…' : 'KEV catalog unavailable. No queue can be ranked; this does not mean there are no vulnerabilities.'}</p>`;
    else {
      const terms = getCyberWatchlist(), ranked = prioritizeCyber(kev.items, epss, cvss, terms, this.filters);
      const vendors = [...new Set(kev.items.map(i => i.vendor))].sort();
      const products = [...new Set(kev.items.filter(i => this.filters.vendor === 'all' || i.vendor === this.filters.vendor).map(i => i.product))].sort();
      body = safeHtml`<p class="cyber-note">Watchlist matches first, then EPSS likelihood, then newest KEV additions. All entries have evidence of exploitation in CISA KEV.</p><p class="cyber-note">${epss ? safeHtml`EPSS ${epss.scoreDate} · ${epss.items.length}/${epss.requestedCount} catalog IDs scored` : 'EPSS unavailable — likelihood unknown'} · ${cvss ? safeHtml`CVSS ${cvss.items.filter(i => i.score !== null).length}/${cvss.items.length} recent records scored` : 'CVSS unavailable — severity unknown'}</p><details class="cyber-methodology"><summary>How priorities and coverage work</summary><p class="cyber-note">Known exploitation: every entry is in CISA KEV. Default order: watchlist matches first, then EPSS likelihood, then newest KEV addition. Higher likelihood means EPSS ≥10% (dashboard threshold). No installed-version exposure is inferred.</p><p class="cyber-note">${epss ? safeHtml`EPSS score date ${epss.scoreDate} · model ${epss.model} · ${epss.items.length} scored of ${epss.requestedCount} catalog IDs at collection.` : 'EPSS unavailable: likelihood is unknown; KEV and watchlist priorities remain usable.'} EPSS estimates exploitation activity over the next 30 days, not impact or your chance of compromise.</p><p class="cyber-note">${cvss ? safeHtml`CVSS coverage: ${cvss.items.length} newest KEV additions checked; ${cvss.items.filter(i => i.score !== null).length} supplied general base scores.` : 'CVSS unavailable.'} Technical severity is separate from exploitation likelihood. Uncovered or unscored records stay Unknown. CNA scores preferred, then ADP; newest CVSS version, highest general base score within that version.</p></details><div class="cyber-priority-filters">${this.select('vendor', 'Vendor', vendors)}${this.select('product', 'Product', products)}${this.select('severity', 'Technical severity', ['Critical', 'High', 'Medium', 'Low', 'None', 'Unknown'])}<label>New KEV additions<select aria-label="New KEV additions" data-priority-filter="days">${joinSafeHtml([['all','Any date'],['7','Last 7 days'],['30','Last 30 days']].map(([v,l]) => safeHtml`<option value="${v}" ${this.filters.days === v ? safeHtml`selected` : ''}>${l}</option>`))}</select></label><label>Search vulnerabilities<input aria-label="Search vulnerabilities" data-priority-filter="query" value="${this.filters.query}" maxlength="100"></label><label>Order<select aria-label="Priority order" data-priority-filter="sort">${joinSafeHtml([['attention','Attention'],['epss','EPSS likelihood'],['newest','Newest KEV additions']].map(([v,l]) => safeHtml`<option value="${v}" ${this.filters.sort === v ? safeHtml`selected` : ''}>${l}</option>`))}</select></label><label><input type="checkbox" data-priority-filter="watched" ${this.filters.watched ? safeHtml`checked` : ''}> Watchlist matches only</label><button type="button" data-priority-reset>Reset queue filters</button></div><p class="cyber-note">${ranked.length} matching KEV entries · ${terms.length} watchlist keywords. ${!terms.length ? 'Add technologies in My Technology Watchlist to personalize this queue.' : 'Watchlist terms remain in this browser.'}</p>${ranked.length ? joinSafeHtml(ranked.slice(0, this.limit).map(r => safeHtml`<article class="cyber-card" data-priority-cve="${r.item.id}"><div class="cyber-eyebrow">${r.tier} · ${r.item.vendor} · ${r.item.product}</div><a class="cyber-headline" href="${safeUrlAttr(r.item.url)}" target="_blank" rel="noopener noreferrer">${r.item.id} ↗</a><h3>${r.item.title}</h3><p>${r.matches.length ? safeHtml`Watchlist keyword match: ${r.matches.join(', ')}. ` : ''}CISA lists evidence of exploitation. Added ${time(r.item.addedAt)}.</p><p>EPSS likelihood: ${r.epss ? safeHtml`${(r.epss.probability * 100).toFixed(2)}% · percentile ${(r.epss.percentile * 100).toFixed(2)} (${epss!.scoreDate})` : 'Unknown — no usable score'}</p><p>Technical severity: ${r.severity}${r.cvss?.score !== null && r.cvss?.score !== undefined ? safeHtml` · CVSS ${r.cvss.version} ${r.cvss.score.toFixed(1)}/10 · ${r.cvss.provider}` : ''}</p>${r.cvss?.vector ? safeHtml`<details><summary>CVSS source metric</summary><p>${r.cvss.vector}</p><p>Record revised ${time(r.cvss.updatedAt)}</p><a href="${safeUrlAttr('https://www.cve.org/CVERecord?id=' + r.item.id)}" target="_blank" rel="noopener noreferrer">CVE source record ↗</a></details>` : ''}<div class="cyber-action"><strong>CISA required action</strong><p>${r.item.action}</p></div><p class="cyber-note">Ransomware use: ${r.item.ransomware === 'Known' ? 'Known' : 'Unknown (not confirmed)'}. Federal remediation due ${r.item.dueDate}; this deadline applies to covered US federal agencies.</p></article>`)) : safeHtml`<p class="cyber-empty">No entries match these filters in the available catalog.</p>`}${ranked.length > this.limit ? safeHtml`<button data-priority-more>Show 20 more</button>` : ''}`;
    }
    this.setSafeContentImmediate(safeHtml`<div class="cyber-body"><details class="cyber-methodology"><summary>Sources and update times · ${['kev', 'epss', 'cvss'].map(n => n.toUpperCase() + ': ' + (this.latest.get(n)?.status || 'unavailable')).join(' · ')}</summary>${provenance}</details>${body}<button type="button" data-priority-retry>Refresh queue</button></div>`);
  }
  destroy(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); this.unsubscribe(); this.unsubscribeData(); super.destroy(); }
}
