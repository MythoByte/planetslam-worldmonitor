import { Panel } from './Panel';
import { fetchSpaceDataset } from '@/services/space';
import { getSpacePreferences, isSpaceWatched, toggleSpaceWatch, subscribeSpacePreferences, SPACE_WATCH_LIMIT } from '@/services/space-personalization';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';
import type { SpaceDataset, SpaceEnvelope, ApodData, SpaceNewsData, LaunchesData, WeatherData, SolarData, SpaceEventsData, NeoData, SpaceLaunch, SpaceNewsItem, SpaceHealthData } from '@/types/space';
import '@/styles/space.css';

export function spaceTime(time: number | null | undefined): string {
  return time && Number.isFinite(time) ? new Date(time).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'Time unavailable';
}
function number(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}
export function launchCountdown(net: number | null, now = Date.now()): string {
  if (!net || !Number.isFinite(net)) return 'Schedule pending';
  const seconds = Math.ceil((net - now) / 1000);
  if (seconds <= 0) return 'Scheduled time passed · awaiting provider update';
  const days = Math.floor(seconds / 86400);
  return `T−${days ? `${days}d ` : ''}${Math.floor(seconds % 86400 / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`;
}
export function spaceSource<T>(envelope: SpaceEnvelope<T>): SafeHtml {
  return safeHtml`<div class="space-provenance" data-space-status="${envelope.status}"><span class="space-status">${envelope.status === 'fresh' ? 'Updated' : envelope.status === 'stale' ? 'Stale · last known data' : 'Unavailable'}</span><a href="${safeUrlAttr(envelope.sourceUrl)}" target="_blank" rel="noopener noreferrer">${envelope.provider}</a><span>Fetched ${spaceTime(envelope.fetchedAt)}</span>${envelope.observedAt ? safeHtml`<span>${envelope.dataset === 'solar' ? 'Files updated' : 'Observed / published'} ${spaceTime(envelope.observedAt)}</span>` : ''}</div>`;
}
function unavailable(message?: string): SafeHtml {
  return safeHtml`<div class="space-empty"><strong>Data temporarily unavailable</strong><p>${message || 'The provider has not supplied a usable update. This does not indicate that there are no events.'}</p><button type="button" data-space-retry>Retry</button></div>`;
}
function newsCards(items: SpaceNewsItem[]): SafeHtml {
  return joinSafeHtml(items.slice(0, 30).map(item => safeHtml`<article class="space-card"><div class="space-eyebrow">${item.publisher} · ${spaceTime(item.publishedAt)}</div><a class="space-headline" href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">${item.title}</a><p>${item.summary?.slice(0, 260)}</p></article>`));
}
function launchCards(items: SpaceLaunch[]): SafeHtml {
  return joinSafeHtml(items.slice(0, 16).map((item, index) => safeHtml`<article class="space-card ${index === 0 ? 'space-next-launch' : ''}"><div class="space-eyebrow">${item.provider} · ${item.status}</div><a class="space-headline" href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">${item.name}</a><div class="space-countdown" data-launch-net="${item.net || ''}">${launchCountdown(item.net)}</div><time>${spaceTime(item.net)}</time><button type="button" data-launch-watch="${item.id}" aria-pressed="${isSpaceWatched('launch', item.id)}" ${!isSpaceWatched('launch', item.id) && getSpacePreferences().launchWatchlist.length >= SPACE_WATCH_LIMIT ? safeHtml`disabled` : ''}>${isSpaceWatched('launch', item.id) ? '★ Watching launch' : '☆ Watch launch'}</button><p>${item.rocket} · ${item.pad}</p>${item.windowStart || item.windowEnd ? safeHtml`<small>Window ${spaceTime(item.windowStart)} — ${spaceTime(item.windowEnd)}</small>` : ''}<p>${item.mission?.slice(0, 240)}</p>${item.webcastUrl ? safeHtml`<a class="space-action" href="${safeUrlAttr(item.webcastUrl)}" target="_blank" rel="noopener noreferrer">Watch at source ↗</a>` : ''}</article>`));
}
function trend(values: number[], label: string): SafeHtml {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return safeHtml`<p class="space-note">${label}: insufficient recent samples</p>`;
  const min = Math.min(...valid), max = Math.max(...valid);
  const points = valid.map((v, i) => `${(i / (valid.length - 1) * 300).toFixed(1)},${(55 - (v - min) / (max - min || 1) * 48).toFixed(1)}`).join(' ');
  return safeHtml`<figure class="space-trend"><figcaption>${label} <span>${number(min)}–${number(max)}</span></figcaption><svg viewBox="0 0 300 64" role="img" aria-label="${label} recent trend"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" /></svg></figure>`;
}

/** A mounted panel owns refresh/cleanup; provider freshness comes from the server envelope. */
export class SpaceDataPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private latest: SpaceEnvelope<unknown> | null = null;
  private extraNews: SpaceEnvelope<SpaceNewsData> | null = null;
  private apodDate = '';
  private newsFilter = 'all';
  private loading = false;
  private stopped = false;
  private unsubscribePreferences: () => void;

  constructor(id: string, title: string, private dataset: SpaceDataset) {
    super({ id, title, className: 'space-panel', infoTooltip: 'Shared provider data with source attribution and observation time. Times are UTC. Updates can be delayed.' });
    this.unsubscribePreferences = dataset === 'launches' ? subscribeSpacePreferences(() => this.renderLatest()) : () => {};
    this.content.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-space-retry], [data-apod-date], [data-launch-watch]');
      if (target?.dataset.launchWatch) { toggleSpaceWatch('launch', target.dataset.launchWatch); return; }
      if (target?.hasAttribute('data-space-retry')) void this.fetchData(true);
      if (target?.dataset.apodDate) { this.apodDate = target.dataset.apodDate; this.renderLatest(); }
    }, { signal: this.signal });
    this.content.addEventListener('change', event => {
      const target = event.target as HTMLSelectElement;
      if (target.matches('[data-space-news-filter]')) { this.newsFilter = target.value; this.renderLatest(); }
    }, { signal: this.signal });
    this.runWhenConnected(() => {
      void this.fetchData();
      this.refreshTimer = setInterval(() => {
        if (this.canHostLiveMedia() && document.visibilityState !== 'hidden') void this.fetchData();
      }, 60_000);
      if (dataset === 'launches') this.countdownTimer = setInterval(() => {
        if (!this.canHostLiveMedia()) return;
        for (const el of this.content.querySelectorAll<HTMLElement>('[data-launch-net]')) el.textContent = launchCountdown(Number(el.dataset.launchNet) || null);
      }, 1000);
    });
  }

  async fetchData(force = false): Promise<void> {
    if (this.loading || this.stopped) return;
    this.loading = true;
    try {
      if (this.panelId === 'space-spacex') {
        try { this.extraNews = await fetchSpaceDataset<SpaceNewsData>('news', force); } catch { this.extraNews = null; }
      }
      const result = await fetchSpaceDataset(this.dataset, force);
      if (this.stopped) return;
      this.latest = result;
      if (!this.stopped) this.renderLatest();
    } catch {
      if (this.stopped) return;
      // An HTTP failure never leaves an old green freshness badge in place.
      this.latest = { dataset: this.dataset, status: 'unavailable', provider: 'Space data service', sourceUrl: '/api/space?dataset=' + this.dataset, fetchedAt: null, observedAt: null, expiresAt: null, data: null };
      this.renderLatest();
    } finally { this.loading = false; }
  }

  private renderLatest(): void {
    const envelope = this.latest;
    if (!envelope) return;
    let body: SafeHtml;
    if (this.dataset === 'health' && envelope.data) body = this.renderData(envelope.data);
    else if (this.panelId === 'space-spacex' && (envelope.status === 'unavailable' || !envelope.data)) {
      body = safeHtml`${unavailable(envelope.message)}<h3>Latest SpaceX coverage</h3>${this.extraNews ? spaceSource(this.extraNews) : ''}${newsCards(this.extraNews?.data?.items.filter(item => /spacex|starship|starlink|falcon/i.test(item.title + ' ' + item.summary)) || [])}`;
    }
    else if (envelope.status === 'unavailable' || !envelope.data) body = unavailable(envelope.message);
    else {
      try { body = this.renderData(envelope.data); }
      catch { body = unavailable('The latest provider response could not be displayed.'); }
    }
    // Deliberately use a visible unavailable state; PlanetSlam must not hide a requested panel.
    this.setSafeContentImmediate(safeHtml`<div class="space-body">${spaceSource(envelope)}${envelope.message && envelope.status !== 'unavailable' ? safeHtml`<p class="space-note">${envelope.message}</p>` : ''}${body}</div>`);
  }

  private renderData(raw: unknown): SafeHtml {
    switch (this.dataset) {
      case 'apod': {
        const items = (raw as ApodData).items;
        const item = items.find(item => item.date === this.apodDate) || items[0];
        if (!item) return safeHtml`<p class="space-empty">No picture has been published for this period.</p>`;
        return safeHtml`<nav class="space-archive" aria-label="Picture archive">${joinSafeHtml(items.map(i => safeHtml`<button type="button" data-apod-date="${i.date}" aria-pressed="${i.date === item.date}">${i.date}</button>`))}</nav><h3>${item.title}</h3>${item.mediaType === 'image' ? safeHtml`<a href="${safeUrlAttr(item.hdUrl || item.url)}" target="_blank" rel="noopener noreferrer"><img class="space-hero-image" src="${safeUrlAttr(item.url)}" alt="${item.title}" loading="lazy" referrerpolicy="no-referrer" /></a>` : safeHtml`${item.thumbnailUrl ? safeHtml`<img class="space-hero-image" src="${safeUrlAttr(item.thumbnailUrl)}" alt="${item.title}" loading="lazy" />` : ''}<a class="space-action" href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">Watch today’s video at source ↗</a>`}<div class="space-eyebrow">${item.date} · Credit: ${item.credit || 'NASA / APOD; see source for rights'}</div><details><summary>Read the explanation</summary><p>${item.explanation}</p></details><a href="${safeUrlAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Original picture and credits ↗</a>`;
      }
      case 'news': {
        const items = (raw as SpaceNewsData).items;
        const filtered = this.newsFilter === 'all' ? items : items.filter(item => new RegExp(this.newsFilter, 'i').test(item.title + ' ' + item.summary));
        return safeHtml`<label class="space-filter">Topics <select data-space-news-filter aria-label="Space news topic">${joinSafeHtml([['all', 'All space'], ['spacex|starship|starlink|falcon', 'SpaceX'], ['launch|rocket', 'Launches'], ['science|telescope|planet|moon|mars', 'Science & exploration']].map(([value, label]) => safeHtml`<option value="${value}" ${value === this.newsFilter ? safeHtml`selected` : ''}>${label}</option>`))}</select></label>${filtered.length ? newsCards(filtered) : safeHtml`<p class="space-empty">No matching headlines in the latest feed.</p>`}`;
      }
      case 'launches': {
        const items = (raw as LaunchesData).items;
        if (this.panelId === 'space-spacex') {
          const launches = items.filter(item => /spacex/i.test(item.provider));
          const news = this.extraNews?.data?.items.filter(item => /spacex|starship|starlink|falcon/i.test(item.title + ' ' + item.summary)) || [];
          return safeHtml`<p class="space-note">Official mission links and independently reported SpaceX coverage.</p>${launches.length ? launchCards(launches.slice(0, 3)) : safeHtml`<p>No SpaceX launch listed in the current upcoming batch.</p>`}<a class="space-action" href="https://www.spacex.com/launches/" target="_blank" rel="noopener noreferrer">Official SpaceX missions ↗</a><h3>Latest SpaceX coverage</h3>${this.extraNews ? spaceSource(this.extraNews) : safeHtml`<p class="space-note">News feed unavailable.</p>`}${news.length ? newsCards(news.slice(0, 8)) : safeHtml`<p>No SpaceX headlines in the current feed.</p>`}`;
        }
        return safeHtml`<p class="space-note">Times are NET (no earlier than). Launch windows and status can change.</p>${items.length ? launchCards(items) : safeHtml`<p class="space-empty">No upcoming launches returned by the provider.</p>`}`;
      }
      case 'weather': {
        const data = raw as WeatherData;
        const latest = data.wind[data.wind.length - 1];
        return safeHtml`<div class="space-metrics">${joinSafeHtml(([['G', 'Geomagnetic storm'], ['R', 'Radio blackout'], ['S', 'Solar radiation']] as const).map(([key, label]) => safeHtml`<div class="space-metric"><strong>${data.scales[key] === null ? '—' : key + data.scales[key]}</strong><span>${label}</span></div>`))}</div><p class="space-note">NOAA severity scales: 0 means no rated event, 1–5 indicate increasing severity. Missing observations show —.</p><div class="space-metrics"><div class="space-metric"><strong>${number(data.kp[data.kp.length - 1]?.value)}</strong><span>Planetary Kp</span></div><div class="space-metric"><strong>${number(latest?.speed, 0)}</strong><span>Solar wind · km/s</span></div><div class="space-metric"><strong>${number(latest?.bz)}</strong><span>IMF Bz · nT</span></div></div>${trend(data.kp.map(p => p.value), 'Planetary Kp')}${trend(data.wind.flatMap(p => p.speed === null ? [] : [p.speed]), 'Solar wind · km/s')}<h3>NOAA alerts and bulletins</h3>${data.alerts.length ? joinSafeHtml(data.alerts.slice(0, 8).map(alert => safeHtml`<details class="space-card"><summary>${spaceTime(alert.issuedAt)} · ${alert.id}</summary><pre class="space-alert">${alert.message}</pre></details>`)) : safeHtml`<p>No bulletins in the returned feed.</p>`}<a href="https://www.spaceweather.gov/" target="_blank" rel="noopener noreferrer">Official NOAA forecasts and impacts ↗</a>`;
      }
      case 'neo': {
        const items = (raw as NeoData).items;
        return safeHtml`<p class="space-note">Next seven days of close approaches. “Potentially hazardous” is an orbital/size classification, not an impact prediction. LD = Earth–Moon distance. Sizes are estimates.</p><div class="space-table-scroll"><table class="space-table"><thead><tr><th>Object / UTC approach</th><th>Size (m)</th><th>Miss distance</th><th>Speed</th><th>Classification</th></tr></thead><tbody>${joinSafeHtml(items.map(item => safeHtml`<tr><td><a href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">${item.name}</a><small>${spaceTime(item.approachAt)}</small></td><td>${number(item.diameterMinKm * 1000, 0)}–${number(item.diameterMaxKm * 1000, 0)}</td><td>${number(item.lunarDistance, 2)} LD<small>${number(item.missDistanceKm, 0)} km</small></td><td>${number(item.velocityKmS)} km/s</td><td>${item.potentiallyHazardous ? 'Potentially hazardous' : 'Not classified hazardous'}</td></tr>`))}</tbody></table></div>${!items.length ? safeHtml`<p>No approaches returned for this date range.</p>` : ''}`;
      }
      case 'solar': {
        const items = (raw as SolarData).items;
        return safeHtml`<p class="space-note">Solar observations use different wavelengths and false colour. Image file update times are shown; these can differ from instrument observation times.</p><div class="space-solar-grid">${joinSafeHtml(items.map(item => safeHtml`<figure><a href="${safeUrlAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer"><img class="space-solar-image" src="${safeUrlAttr(item.url)}" alt="${item.title}" loading="lazy" referrerpolicy="no-referrer" /></a><figcaption>${item.title}<small>File updated ${spaceTime(item.observedAt)}</small></figcaption></figure>`))}</div><p class="space-note">Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams.</p>`;
      }
      case 'events': {
        const items = (raw as SpaceEventsData).items;
        return safeHtml`<p class="space-note">Recent NASA DONKI solar flares and coronal mass ejections. A recorded eruption does not by itself predict an Earth impact.</p>${items.length ? joinSafeHtml(items.map(item => safeHtml`<article class="space-card"><div class="space-eyebrow">${item.type === 'cme' ? 'Coronal mass ejection' : 'Solar flare'} ${item.classType} · ${spaceTime(item.time)}</div><a href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">${item.id}</a><p>${item.note?.slice(0, 400)}</p></article>`)) : safeHtml`<p>No events reported in the current period.</p>`}`;
      }
      case 'health': {
        const items = (raw as SpaceHealthData).items;
        return safeHtml`<p class="space-note">Provider health reflects the cached datasets, not browser connectivity. Missing data is never counted as a quiet sky.</p>${joinSafeHtml(items.map(item => safeHtml`<article class="space-card"><h3>${item.dataset}</h3>${spaceSource(item)}${item.message ? safeHtml`<p>${item.message}</p>` : ''}</article>`))}`;
      }
      default: return unavailable();
    }
  }

  override destroy(): void {
    this.stopped = true; this.unsubscribePreferences();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    super.destroy();
  }
}
