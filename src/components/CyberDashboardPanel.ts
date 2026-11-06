import { Panel } from './Panel';
import { fetchCyberDataset } from '@/services/cyber-dashboard';
import { getCyberWatchlist, saveCyberWatchlist, subscribeCyberWatchlist, cyberMatches, CYBER_WATCH_PRESETS, CYBER_WATCH_LIMIT } from '@/services/cyber-watchlist';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';
import type { CyberDataset, CyberEnvelope, CyberNewsData, CyberKevData, CyberHealthData, CyberNewsItem, CyberKevItem } from '@/types/cyber-dashboard';
import '@/styles/cyber.css';

const time = (n: number | null) => n && Number.isFinite(n) ? new Date(n).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Not available';
const statusLabel = (s: string) => s === 'fresh' ? 'Updated' : s === 'stale' ? 'Delayed · last known data' : 'Unavailable';
function provenance(e: CyberEnvelope<unknown>): SafeHtml {
  return safeHtml`<div class="cyber-provenance" data-cyber-status="${e.status}"><span class="cyber-status">${statusLabel(e.status)}</span><a href="${safeUrlAttr(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e.provider} ↗</a><span>Fetched ${time(e.fetchedAt)}</span>${e.observedAt ? safeHtml`<span>Latest publication ${time(e.observedAt)}</span>` : ''}</div>`;
}
function unavailable(e: CyberEnvelope<unknown>): SafeHtml {
  return safeHtml`<div class="cyber-empty"><strong>Data temporarily unavailable</strong><p>${e.message || 'The data service could not be reached. This does not mean there are no threats.'}</p><button type="button" data-cyber-retry>Retry</button></div>`;
}
function newsCards(items: CyberNewsItem[]): SafeHtml {
  return joinSafeHtml(items.map(i => safeHtml`<article class="cyber-card"><div class="cyber-eyebrow">${i.topic} · ${i.publisher}</div><a class="cyber-headline" href="${safeUrlAttr(i.url)}" target="_blank" rel="noopener noreferrer">${i.title} ↗</a><time>${time(i.publishedAt)}</time><p>${i.summary}</p>${matchBadge(i.title + ' ' + i.summary)}</article>`));
}
function matchBadge(text: string): SafeHtml {
  const matches = cyberMatches(text);
  return matches.length ? safeHtml`<span class="cyber-match">Watchlist keyword: ${matches.join(', ')}</span>` : safeHtml``;
}
function kevCards(items: CyberKevItem[]): SafeHtml {
  return joinSafeHtml(items.map(i => safeHtml`<article class="cyber-card"><div class="cyber-eyebrow">${i.vendor} · ${i.product}</div><a class="cyber-headline" href="${safeUrlAttr(i.url)}" target="_blank" rel="noopener noreferrer">${i.id} ↗</a><h3>${i.title}</h3><time>Added to KEV ${time(i.addedAt)}</time><p>${i.description}</p><div class="cyber-action"><strong>Required action</strong><p>${i.action}</p></div><p class="cyber-note">Federal remediation due: ${i.dueDate} · Ransomware use: ${i.ransomware === 'Known' ? 'Known' : 'Unknown (not confirmed)'}</p>${joinSafeHtml(i.references.map((url, index) => safeHtml`<a class="cyber-reference" href="${safeUrlAttr(url)}" target="_blank" rel="noopener noreferrer">Advisory / reference ${index + 1} ↗</a>`))}${matchBadge(i.vendor + ' ' + i.product + ' ' + i.title)}</article>`));
}

export class CyberDashboardPanel extends Panel {
  private latest: Partial<Record<CyberDataset, CyberEnvelope<unknown>>> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading = false;
  private stopped = false;
  private topic = 'all';
  private query = '';
  private watchedOnly = false;
  private limit = 20;
  private storageError = false;
  private unsubscribe: () => void;
  constructor(id: string, title: string, private dataset: CyberDataset | 'watchlist') {
    super({ id, title, className: 'cyber-panel', defaultRowSpan: 2,
      infoTooltip: 'Source-linked cyber reporting and the CISA KEV catalog. Times are UTC. Keyword matches do not establish exposure of an installed version.' });
    this.unsubscribe = subscribeCyberWatchlist(() => { this.limit = 20; this.renderLatest(); });
    this.content.addEventListener('click', event => {
      const el = (event.target as HTMLElement).closest<HTMLElement>('[data-cyber-retry], [data-watch-add], [data-watch-remove], [data-cyber-more]');
      if (!el) return;
      if (el.hasAttribute('data-cyber-retry')) { void this.fetchData(true); return; }
      if (el.hasAttribute('data-cyber-more')) { this.limit += 20; this.renderLatest(); return; }
      const terms = getCyberWatchlist();
      if (el.dataset.watchAdd && terms.length < CYBER_WATCH_LIMIT) this.storageError = !saveCyberWatchlist([...terms, el.dataset.watchAdd]);
      if (el.dataset.watchRemove) this.storageError = !saveCyberWatchlist(terms.filter(t => t !== el.dataset.watchRemove));
      this.renderLatest();
    }, { signal: this.signal });
    this.content.addEventListener('submit', event => {
      const form = event.target as HTMLFormElement;
      if (!form.matches('[data-cyber-watch-form]')) return;
      event.preventDefault(); const input = form.querySelector('input')!;
      if (getCyberWatchlist().length < CYBER_WATCH_LIMIT && input.value.trim().length >= 2) this.storageError = !saveCyberWatchlist([...getCyberWatchlist(), input.value]);
      this.renderLatest();
    }, { signal: this.signal });
    this.content.addEventListener('change', event => {
      const el = event.target as HTMLInputElement;
      if (el.matches('[data-cyber-topic]')) this.topic = el.value;
      if (el.matches('[data-cyber-query]')) this.query = el.value;
      if (el.matches('[data-cyber-watched]')) this.watchedOnly = el.checked;
      this.limit = 20; this.renderLatest();
    }, { signal: this.signal });
    this.runWhenConnected(() => {
      this.renderLatest(); void this.fetchData();
      this.timer = setInterval(() => { if (this.canHostLiveMedia() && document.visibilityState !== 'hidden') void this.fetchData(); }, 60_000);
    });
  }
  async fetchData(force = false): Promise<void> {
    if (this.loading || this.stopped) return;
    this.loading = true;
    const names: CyberDataset[] = this.dataset === 'watchlist' ? ['news', 'kev'] : [this.dataset];
    await Promise.all(names.map(async name => {
      try { const e = await fetchCyberDataset(name, force); if (!this.stopped) this.latest[name] = e; }
      catch { if (!this.stopped) this.latest[name] = { dataset: name, status: 'unavailable', provider: 'Cyber data service', sourceUrl: '/api/cyber-dashboard?dataset=' + name, fetchedAt: null, observedAt: null, expiresAt: null, data: null }; }
    }));
    this.loading = false; if (!this.stopped) this.renderLatest();
  }
  private renderLatest(): void {
    let body: SafeHtml;
    if (this.dataset === 'watchlist') body = this.renderWatchlist();
    else {
      const e = this.latest[this.dataset];
      if (!e) body = safeHtml`<p class="cyber-empty">Loading shared cyber data…</p>`;
      else {
        let content: SafeHtml;
        if (this.dataset === 'health' && e.data) content = this.renderHealth(e as CyberEnvelope<CyberHealthData>);
        else if (!e.data || e.status === 'unavailable') content = unavailable(e);
        else if (this.dataset === 'news') content = this.renderNews(e as CyberEnvelope<CyberNewsData>);
        else content = this.renderKev(e as CyberEnvelope<CyberKevData>);
        body = safeHtml`${provenance(e)}${e.message && e.status !== 'unavailable' ? safeHtml`<p class="cyber-note">${e.message}</p>` : ''}${content}`;
      }
    }
    this.setSafeContentImmediate(safeHtml`<div class="cyber-body">${body}</div>`);
  }
  private renderNews(e: CyberEnvelope<CyberNewsData>): SafeHtml {
    const items = e.data!.items.filter(i => (this.topic === 'all' || i.topic === this.topic) && (!this.watchedOnly || cyberMatches(i.title + ' ' + i.summary).length));
    return safeHtml`<div class="cyber-toolbar"><label>Topic <select data-cyber-topic>${joinSafeHtml(['all', 'Ransomware', 'Vulnerabilities', 'Breaches', 'Malware', 'Phishing', 'Security'].map(t => safeHtml`<option value="${t}" ${this.topic === t ? safeHtml`selected` : ''}>${t === 'all' ? 'All topics' : t}</option>`))}</select></label>${this.watchFilter()}</div><p class="cyber-note">${items.length} articles in the last 7 days · Categories use headline keywords.</p>${newsCards(items.slice(0, this.limit))}${items.length ? this.more(items.length) : safeHtml`<p class="cyber-empty">No articles match this filter in the available coverage.</p>`}`;
  }
  private watchFilter(): SafeHtml {
    return safeHtml`<label><input type="checkbox" data-cyber-watched ${this.watchedOnly ? safeHtml`checked` : ''}> Watchlist only</label>`;
  }
  private renderKev(e: CyberEnvelope<CyberKevData>): SafeHtml {
    const q = this.query.toLowerCase().trim();
    const items = e.data!.items.filter(i => (!q || `${i.id} ${i.vendor} ${i.product} ${i.title}`.toLowerCase().includes(q)) && (!this.watchedOnly || cyberMatches(i.vendor + ' ' + i.product + ' ' + i.title).length));
    return safeHtml`<p class="cyber-note">CISA catalog ${e.data!.version} · ${e.data!.totalCount.toLocaleString()} vulnerabilities with evidence of exploitation. Newest additions first. Catalog inclusion does not establish exploitation of your systems.</p><div class="cyber-toolbar"><label>Search catalog <input type="search" data-cyber-query value="${this.query}" placeholder="CVE, vendor or product" maxlength="100"></label>${this.watchFilter()}<button type="button" data-cyber-retry>Refresh</button></div><p class="cyber-note">${items.length} matches · Federal due dates apply to covered US federal agencies.</p>${kevCards(items.slice(0, this.limit))}${items.length ? this.more(items.length) : safeHtml`<p class="cyber-empty">No catalog entries match this filter. This is not proof of safety.</p>`}`;
  }
  private more(total: number): SafeHtml { return total > this.limit ? safeHtml`<button type="button" class="cyber-more" data-cyber-more>Show 20 more (${Math.min(this.limit, total)} of ${total})</button>` : safeHtml``; }
  private renderHealth(e: CyberEnvelope<CyberHealthData>): SafeHtml {
    return safeHtml`<p class="cyber-note">Feed health describes successful retrieval, not the safety of the internet. Publication dates can be older than fetch times. News coverage is limited to the publishers below.</p>${joinSafeHtml(e.data!.items.map(i => safeHtml`<article class="cyber-card">${provenance(i)}<p>${i.message || 'Latest shared snapshot available.'}</p></article>`))}<button type="button" data-cyber-retry>Refresh status</button>`;
  }
  private renderWatchlist(): SafeHtml {
    const terms = getCyberWatchlist();
    const news = this.latest.news as CyberEnvelope<CyberNewsData> | undefined;
    const kev = this.latest.kev as CyberEnvelope<CyberKevData> | undefined;
    const matches = news?.data?.items.filter(i => cyberMatches(i.title + ' ' + i.summary, terms).length) || [];
    const vulns = kev?.data?.items.filter(i => cyberMatches(i.vendor + ' ' + i.product + ' ' + i.title, terms).length) || [];
    return safeHtml`<p class="cyber-note">Follow vendor or product keywords. Saved in this browser only. Matches are informational; installed versions and actual exposure are not checked.</p><div class="cyber-chips">${joinSafeHtml(terms.map(t => safeHtml`<button type="button" data-watch-remove="${t}" aria-label="Remove ${t}">${t} ×</button>`))}</div><form data-cyber-watch-form class="cyber-toolbar"><label>Technology <input name="technology" type="text" placeholder="e.g. Nextcloud" minlength="2" maxlength="60" required></label><button type="submit" ${terms.length >= CYBER_WATCH_LIMIT ? safeHtml`disabled` : ''}>Add keyword</button></form><p class="cyber-note">${terms.length}/${CYBER_WATCH_LIMIT} keywords · Quick add:</p><div class="cyber-chips">${joinSafeHtml(CYBER_WATCH_PRESETS.filter(t => !terms.includes(t.toLowerCase())).map(t => safeHtml`<button type="button" data-watch-add="${t}" ${terms.length >= CYBER_WATCH_LIMIT ? safeHtml`disabled` : ''}>+ ${t}</button>`))}</div>${this.storageError ? safeHtml`<p role="alert">Unable to save. Browser storage is unavailable.</p>` : ''}${!terms.length ? safeHtml`<p class="cyber-empty">Add a technology to see matching news and catalog entries here.</p>` : safeHtml`<h3>Matching news · ${matches.length}</h3>${news ? provenance(news) : ''}${news?.status === 'unavailable' ? unavailable(news) : !news ? safeHtml`<p>Loading news…</p>` : matches.length ? newsCards(matches.slice(0, this.limit)) : safeHtml`<p class="cyber-note">No matching articles in the available coverage.</p>`}<h3>Matching exploited vulnerabilities · ${vulns.length}</h3>${kev ? provenance(kev) : ''}${kev?.status === 'unavailable' ? unavailable(kev) : !kev ? safeHtml`<p>Loading catalog…</p>` : vulns.length ? kevCards(vulns.slice(0, this.limit)) : safeHtml`<p class="cyber-note">No matching catalog entries. This is not proof of safety.</p>`}${this.more(Math.max(matches.length, vulns.length))}`}`;
  }
  override destroy(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); this.unsubscribe(); super.destroy(); }
}
