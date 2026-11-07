import { Panel } from './Panel';
import { fetchCyberDataset, subscribeCyberDataset } from '@/services/cyber-dashboard';
import { cyberMatches, getCyberWatchlist, subscribeCyberWatchlist } from '@/services/cyber-watchlist';
import { safeHtml, safeUrlAttr, joinSafeHtml, type SafeHtml } from '@/utils/sanitize';
import type { CyberEnvelope, CyberBriefData, CyberBriefEvidence } from '@/types/cyber-dashboard';
import '@/styles/cyber.css';
const time = (n: number | null) => n ? new Date(n).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Not available';
export class CyberBriefPanel extends Panel {
  private latest: CyberEnvelope<CyberBriefData> | null = null;
  private loading = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: () => void;
  private unsubscribeData: () => void;
  constructor() {
    super({ id: 'cyber-brief', title: 'Cyber Daily Brief', className: 'cyber-panel', defaultRowSpan: 3,
      infoTooltip: 'Dated excerpts from cached reporting. AI may select existing evidence IDs, never write new facts. Watchlist matching happens only in this browser.' });
    this.unsubscribe = subscribeCyberWatchlist(() => this.render());
    this.unsubscribeData = subscribeCyberDataset(e => { if (e.dataset === 'brief') { this.latest = e as CyberEnvelope<CyberBriefData>; this.render(); } });
    this.content.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-brief-retry]')) void this.refresh(true);
    }, { signal: this.signal });
    this.runWhenConnected(() => {
      void this.refresh();
      this.timer = setInterval(() => { if (this.canHostLiveMedia() && document.visibilityState !== 'hidden') void this.refresh(); }, 60000);
    });
  }
  private async refresh(force = false): Promise<void> {
    if (this.loading || this.stopped) return;
    this.loading = true;
    try { const e = await fetchCyberDataset<CyberBriefData>('brief', force); if (!this.stopped) this.latest = e; }
    catch { if (!this.stopped) this.latest = null; }
    this.loading = false; this.render();
  }
  private card(c: CyberBriefEvidence, factIds: string[], watch = false): SafeHtml {
    const matches = cyberMatches(c.title + ' ' + c.facts.map(f => f.text).join(' '));
    return safeHtml`<article class="cyber-card" data-brief-evidence="${c.id}" data-brief-kind="${c.kind}"><div class="cyber-eyebrow">${c.kind === 'research' ? 'Older research context · reported, not independently verified' : c.kind === 'kev' ? 'New KEV addition · evidence of exploitation' : 'Source reporting'} · ${c.publisher}</div><a class="cyber-headline" href="${safeUrlAttr(c.url)}" target="_blank" rel="noopener noreferrer">${c.title} ↗</a><p class="cyber-note">${c.kind === 'kev' ? 'Added to KEV' : 'Published / reported'} ${time(c.publishedAt)}</p>${joinSafeHtml(c.facts.filter(f => factIds.includes(f.id)).map(f => safeHtml`<p>${f.text}</p>`))}${matches.length ? safeHtml`<span class="cyber-match">Watchlist keyword: ${matches.join(', ')}</span>` : ''}<details><summary>Evidence and source clock</summary><p class="cyber-note">Collected ${time(c.fetchedAt)} · ${c.status === 'unavailable' ? 'Original feed snapshot now expired; retained here as dated evidence' : c.status === 'stale' ? 'Original feed snapshot delayed' : 'Feed snapshot fresh'}.</p><p class="cyber-note">Source excerpts; source claims are not independently verified. ${watch ? 'Matched locally against this brief’s bounded evidence. ' : ''}Keyword matches do not establish installed-version exposure.</p>${joinSafeHtml(c.facts.map(f => safeHtml`<p>${f.text}</p>`))}</details></article>`;
  }
  private render(): void {
    if (this.stopped) return;
    const e = this.latest, d = e?.data && e.status !== 'unavailable' && e.expiresAt !== null && e.expiresAt > Date.now() ? e.data : null;
    let body: SafeHtml;
    if (!d) body = safeHtml`<p class="cyber-empty">${this.loading ? 'Loading Cyber daily brief…' : e?.message || 'Daily brief unavailable. This does not mean there were no threats or incidents.'}</p>`;
    else {
      const selected = d.items.map(i => ({ c: d.candidates.find(c => c.id === i.id)!, ids: i.factIds }));
      const watch = d.candidates.filter(c => cyberMatches(c.title + ' ' + c.facts.map(f => f.text).join(' ')).length);
      const fallback = { 'not-configured': 'AI is not configured for this worker.', failed: 'AI curation was unavailable.', rejected: 'AI output did not pass evidence validation.', 'admission-used': 'The daily AI attempt was already used.', curated: '' }[d.aiStatus];
      body = safeHtml`<div class="cyber-brief-heading"><strong>${d.date} UTC</strong><span>${d.mode === 'ai-curated' ? 'AI-curated source digest' : 'Source digest'}</span></div><p class="cyber-note">Reporting window: ${time(d.periodStart)} to ${time(d.periodEnd)} (end exclusive). Generated ${time(d.generatedAt)}.</p>${e?.status === 'stale' ? safeHtml`<p class="cyber-note">Previous UTC day brief; read the original reporting window.</p>` : ''}<p class="cyber-note">${d.mode === 'ai-curated' ? safeHtml`Selected by ${d.model}; displayed facts remain source excerpts.` : safeHtml`${fallback} Showing deterministic source excerpts.`} Coverage is limited to cached feeds, not a complete incident count.</p><details class="cyber-methodology"><summary>Source coverage · ${d.candidates.length} evidence candidates</summary>${joinSafeHtml(d.coverage.map(c => safeHtml`<p class="cyber-note">${c.dataset}: ${c.status} · collected ${time(c.fetchedAt)} · ${c.itemCount} cached rows / ${c.selectedCount} evidence candidates.</p>`))}<p class="cyber-note">Missing feeds, no selected highlights, or no matches do not establish a quiet or safe day. Older monthly incident research is context, not daily attack telemetry. One shared briefing is generated per UTC day; reading or refreshing this panel only reads its cache.</p></details>${joinSafeHtml(['news', 'kev', 'research'].map(kind => {
        const rows = selected.filter(i => i.c.kind === kind);
        return safeHtml`<section class="cyber-brief-section"><h3>${kind === 'news' ? 'Selected reporting' : kind === 'kev' ? 'New KEV additions' : 'Research context'}</h3>${kind === 'research' ? safeHtml`<p class="cyber-note">Latest bounded monthly sample; publication can predate the daily window.</p>` : ''}${rows.length ? joinSafeHtml(rows.map(i => this.card(i.c, i.ids))) : safeHtml`<p class="cyber-note">No selected items in this briefing’s available coverage.</p>`}</section>`;
      }))}<section class="cyber-brief-section" data-brief-watchlist><h3>Your watchlist in this briefing</h3><p class="cyber-note">Matches all ${d.candidates.length} captured evidence candidates locally, including those not selected by AI. Keywords stay in this browser.</p>${!getCyberWatchlist().length ? safeHtml`<p>Add technologies in My Technology Watchlist to personalize this section.</p>` : watch.length ? safeHtml`<p class="cyber-note">${watch.length} keyword matches · showing up to 5.</p>${joinSafeHtml(watch.slice(0, 5).map(c => this.card(c, c.facts.map(f => f.id), true)))}` : safeHtml`<p>No watchlist keywords match this briefing’s bounded coverage. Check the Watchlist and Attention Queue for broader cached coverage.</p>`}</section>`;
    }
    this.setSafeContentImmediate(safeHtml`<div class="cyber-body">${body}<button type="button" data-brief-retry>Refresh cached brief</button></div>`);
  }
  destroy(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); this.unsubscribe(); this.unsubscribeData(); super.destroy(); }
}
