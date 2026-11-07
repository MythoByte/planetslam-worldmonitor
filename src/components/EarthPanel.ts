import { Panel } from './Panel';
import { fetchEarthDataset, ageEarthEnvelope, filterEarthEvents, relatedEarthNews, getSelectedEarthEventId, setSelectedEarthEventId, publishEarthSelection, currentEarthWeather } from '@/services/earth';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/smart-poll-loop';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';
import { EARTH_HAZARDS, EARTH_HAZARD_LABELS, EARTH_SELECT_EVENT, type EarthDataset, type EarthEnvelope, type EarthEvent,
  type EarthHazard, type EarthSource, type EarthRiverItem, type EarthAirQualityItem, type EarthItems, type EarthNewsItem, type EarthWeatherItem, type EarthHealthData, type EarthSelection } from '@/types/earth';
import './earth.css';

const time = (n: number | null | undefined): string => typeof n === 'number' && Number.isFinite(n)
  ? new Date(n).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Time unavailable';
const number = (n: number | null | undefined, digits = 1): string => typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
const label = (value: string): string => value === 'fresh' ? 'Updated' : value === 'stale' ? 'Delayed · last known data' : 'Unavailable';
function source(e: EarthEnvelope<unknown>): SafeHtml {
  const dataSources = e.data && typeof e.data === 'object' && 'sources' in e.data ? (e.data as { sources?: EarthSource[] }).sources : undefined;
  const statuses = e.sources || dataSources || [];
  return safeHtml`<div class="earth-provenance" data-earth-status="${e.status}"><span class="earth-status">${label(e.status)}</span><a href="${safeUrlAttr(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e.provider} ↗</a><span>Fetched ${time(e.fetchedAt)}</span>${e.observedAt ? safeHtml`<span>Latest source time ${time(e.observedAt)}</span>` : ''}</div><p class="earth-note">${e.coverage}</p>${e.message ? safeHtml`<p class="earth-note">${e.message}</p>` : ''}${statuses.length ? safeHtml`<details class="earth-note"><summary>Source status (${statuses.length})</summary>${joinSafeHtml(statuses.map(status => safeHtml`<p><strong>${status.provider}: ${label(status.status)}</strong> · Fetched ${time(status.fetchedAt)}<br>${status.coverage}${status.message ? safeHtml`<br>${status.message}` : ''}</p>`))}</details>` : ''}`;
}
function unavailable(e: EarthEnvelope<unknown>): SafeHtml {
  return safeHtml`<div class="earth-empty"><strong>Data temporarily unavailable</strong><p>${e.message || 'No usable current snapshot is available. Missing coverage does not indicate an absence of hazards.'}</p><button type="button" data-earth-retry>Retry</button></div>`;
}
function options(values: readonly [string, string][], selected: string): SafeHtml {
  return joinSafeHtml(values.map(([value, title]) => safeHtml`<option value="${value}" ${selected === value ? safeHtml`selected` : ''}>${title}</option>`));
}
const EXTENDED_HAZARDS: readonly EarthHazard[] = ['heat', 'cold', 'drought', 'tornado', 'lightning', 'hail', 'winter', 'landslide', 'avalanche', 'coastal'];
const HAZARD_COVERAGE: Partial<Record<EarthHazard, string>> = {
  heat: 'Heat alerts from NWS cover the United States and territories. City forecasts alone do not establish a heatwave.',
  cold: 'Extreme cold and freeze alerts from NWS cover the United States and territories. Forecast temperatures are not an official warning.',
  drought: 'GDACS tracks selected significant drought events worldwide; this is not a continuous drought index or a complete local drought map.',
  tornado: 'NWS tornado alerts cover the United States and territories. A warning identifies a reported or radar-indicated threat, not a confirmed tornado track.',
  lightning: 'Lightning is tagged when a source explicitly identifies it. These feeds do not provide a live global lightning-strike network.',
  hail: 'Hail is tagged when a source explicitly identifies it. NWS severe-weather alerts cover the United States and territories; no complete hail swath is inferred.',
  winter: 'Winter storms, blizzards, snow and ice alerts from NWS cover the United States and territories.',
  landslide: 'NASA EONET tracks selected curated landslide events; NWS may also issue regional debris-flow alerts. This is not a complete landslide inventory or susceptibility forecast.',
  avalanche: 'Avalanche records depend on explicit source alerts or curated events. Coverage is limited; an empty feed does not establish safe mountain conditions.',
  coastal: 'NWS coastal flooding, storm surge, high surf and marine alerts cover its United States and territory service areas. They are not global tide, surge or wave observations.',
};
function hazardLabels(item: Pick<EarthEvent, 'kind' | 'hazards'>): string {
  return [...new Set([item.kind, ...(item.hazards || [])])].map(kind => EARTH_HAZARD_LABELS[kind]).join(' · ');
}
function newsCard(item: EarthNewsItem): SafeHtml {
  return safeHtml`<article class="earth-card"><div class="earth-tags"><span class="earth-tag">${item.official ? 'Official agency update' : 'Reporting'}</span><span>${hazardLabels(item)} · ${item.region}</span></div><h3><a class="earth-headline" href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">${item.title} ↗</a></h3><div class="earth-meta">${item.publisher} · ${time(item.publishedAt)}</div><p>${item.summary}</p>${item.relatedUrls?.length ? safeHtml`<details><summary>Grouped source links (${item.relatedUrls.length})</summary>${joinSafeHtml(item.relatedUrls.map((url, i) => safeHtml`<p><a href="${safeUrlAttr(url)}" target="_blank" rel="noopener noreferrer">Related source ${i + 1} ↗</a></p>`))}</details>` : ''}</article>`;
}

/** Lazy-mounted Earth panels share the cache while owning their controls and refresh lifecycle. */
export class EarthPanel extends Panel {
  private latest: Partial<Record<EarthDataset, EarthEnvelope<unknown>>> = {};
  private poll: SmartPollLoopHandle | null = null;
  private loading = false;
  private stopped = false;
  private hazard = 'all';
  private region = 'all';
  private severity = 'all';
  private hours = '0';
  private newsSource = 'all';
  private location = '';
  private selectedId = getSelectedEarthEventId();
  private limit = 30;
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;

  constructor(id: string, title: string, private dataset: EarthDataset) {
    super({ id, title, className: 'earth-panel', defaultRowSpan: dataset === 'health' ? 2 : 3,
      infoTooltip: 'Source-attributed Earth monitoring. Observations, forecasts and official warnings are shown separately. Times are UTC; coverage varies by provider.' });
    this.setSafeContentImmediate(safeHtml`<div class="earth-body"><p>Loading Earth data…</p></div>`);
    this.content.addEventListener('change', event => {
      const el = event.target as HTMLSelectElement;
      switch (el.dataset.earthFilter) {
        case 'hazard': this.hazard = el.value; break;
        case 'region': this.region = el.value; break;
        case 'severity': this.severity = el.value; break;
        case 'hours': this.hours = el.value; break;
        case 'source': this.newsSource = el.value; break;
        case 'location': this.location = el.value; break;
        default: return;
      }
      this.limit = 30; this.render();
    }, { signal: this.signal });
    this.content.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-earth-retry], [data-earth-details], [data-earth-map], [data-earth-nearby], [data-earth-more], [data-earth-close], [data-earth-browse]');
      if (!target) return;
      if (target.dataset.earthBrowse) { this.hazard = target.dataset.earthBrowse; this.limit = 30; this.render(); this.content.querySelector<HTMLSelectElement>('[data-earth-filter="hazard"]')?.focus(); return; }
      if (target.hasAttribute('data-earth-retry')) { void this.refresh(true); return; }
      if (target.hasAttribute('data-earth-more')) { this.limit += 30; this.render(); return; }
      if (target.hasAttribute('data-earth-close')) { this.selectedId = ''; this.render(); return; }
      const id = target.dataset.earthDetails || target.dataset.earthMap || target.dataset.earthNearby;
      const item = this.events().find(row => row.id === id);
      if (!item) return;
      this.selectedId = item.id; setSelectedEarthEventId(item.id); this.render();
      if (target.hasAttribute('data-earth-details')) this.focusDetail();
      else this.dispatchSelection(item, target.hasAttribute('data-earth-nearby'));
    }, { signal: this.signal });
    if (dataset === 'events' || dataset === 'alerts') {
      window.addEventListener(EARTH_SELECT_EVENT, event => {
        const detail = (event as CustomEvent<EarthSelection>).detail;
        if (detail?.kind !== 'event' || typeof detail.id !== 'string') return;
        this.selectedId = detail.id;
        if (this.events().some(item => item.id === detail.id)) { this.render(); if (detail.origin !== 'panel') this.focusDetail(); }
      }, { signal: this.signal });
    }
    this.runWhenConnected(() => {
      this.poll = startSmartPollLoop(async () => this.refresh(), {
        intervalMs: 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true,
        shouldRun: () => this.canHostLiveMedia(),
      });
      // Age visible snapshots independently of the provider/network polling schedule.
      this.freshnessTimer = setInterval(() => { if (this.canHostLiveMedia()) this.render(); }, 30_000);
    });
  }

  private dispatchSelection(item: EarthEvent, nearby = false): void {
    const detail: EarthSelection = { id: item.id, kind: 'event', origin: 'panel', nearby, ...(item.latitude !== null && item.longitude !== null
      ? { latitude: item.latitude, longitude: item.longitude } : {}) };
    publishEarthSelection(detail);
  }
  private focusDetail(): void {
    const detail = this.content.querySelector<HTMLElement>('[data-earth-selected]');
    detail?.scrollIntoView({ block: 'nearest' }); detail?.focus({ preventScroll: true });
  }
  private datasets(): EarthDataset[] {
    return this.dataset === 'events' ? ['earthquakes', 'events', 'news'] : this.dataset === 'alerts' ? ['alerts', 'news'] : [this.dataset];
  }
  private envelope<T>(dataset: EarthDataset): EarthEnvelope<T> | undefined {
    const latest = this.latest[dataset];
    return latest ? ageEarthEnvelope(latest) as EarthEnvelope<T> : undefined;
  }
  private events(): EarthEvent[] {
    const names: EarthDataset[] = this.dataset === 'events' ? ['earthquakes', 'events'] : ['alerts'];
    return names.flatMap(name => { const e = this.envelope<EarthItems<EarthEvent>>(name); return e?.status !== 'unavailable' ? e?.data?.items || [] : []; });
  }
  private async refresh(force = false): Promise<void> {
    if (this.loading || this.stopped) return;
    this.loading = true;
    const names = this.datasets();
    try {
      const results = await Promise.allSettled(names.map(name => fetchEarthDataset(name, force)));
      if (this.stopped) return;
      results.forEach((result, i) => {
        const name = names[i]!;
        this.latest[name] = result.status === 'fulfilled' ? result.value : { dataset: name, status: 'unavailable',
          provider: 'Earth data service', sourceUrl: `/api/earth?dataset=${name}`, coverage: 'Coverage unavailable during this interruption.',
          fetchedAt: null, observedAt: null, expiresAt: null, data: null, message: 'Earth data service could not be reached. Retry for a current update.' };
      });
      this.render();
    } finally { this.loading = false; }
  }
  private render(): void {
    if (this.stopped) return;
    const envelope = this.envelope<unknown>(this.dataset);
    if (!envelope && !Object.keys(this.latest).length) return;
    let body: SafeHtml;
    if (this.dataset === 'events' || this.dataset === 'alerts') body = this.renderEvents();
    else if (!envelope) body = safeHtml`<p>Loading Earth data…</p>`;
    else if (this.dataset === 'health' && envelope.data) body = safeHtml`${source(envelope)}${this.renderHealth(envelope as EarthEnvelope<EarthHealthData>)}`;
    else if (!envelope.data || envelope.status === 'unavailable') body = safeHtml`${source(envelope)}${unavailable(envelope)}`;
    else {
      body = safeHtml`${source(envelope)}${this.dataset === 'news' ? this.renderNews(envelope as EarthEnvelope<EarthItems<EarthNewsItem>>)
        : this.dataset === 'weather' ? this.renderWeather(envelope as EarthEnvelope<EarthItems<EarthWeatherItem>>)
        : this.dataset === 'rivers' ? this.renderRivers(envelope as EarthEnvelope<EarthItems<EarthRiverItem>>)
        : this.dataset === 'airquality' ? this.renderAirQuality(envelope as EarthEnvelope<EarthItems<EarthAirQualityItem>>) : ''}`;
    }
    this.setSafeContentImmediate(safeHtml`<div class="earth-body">${body}</div>`);
  }
  private renderEvents(): SafeHtml {
    const names: EarthDataset[] = this.dataset === 'events' ? ['earthquakes', 'events'] : ['alerts'];
    const sources = names.flatMap(name => { const e = this.envelope(name); return e ? [e] : []; });
    const all = this.events();
    const items = filterEarthEvents(all, { hazard: this.hazard, region: this.region, severity: this.severity, hours: Number(this.hours) });
    const regions = [...new Set(all.map(item => item.region))].sort();
    const selected = all.find(item => item.id === this.selectedId && (item.expiresAt === null || item.expiresAt > Date.now()));
    return safeHtml`${joinSafeHtml(sources.map(source))}<p class="earth-note">${this.dataset === 'alerts'
      ? 'Official alerts retain their source severity and expiration. GDACS impact alerts and NWS warnings have different coverage and scales.'
      : 'Observed events and ongoing tracked events are distinct from forecasts and warnings. Unknown severity means the provider supplied no comparable rating.'}</p>${this.renderHazardBrowse(all)}<div class="earth-toolbar"><label>Hazard<select data-earth-filter="hazard" aria-label="Hazard">${options([['all', 'All hazards'], ...EARTH_HAZARDS.map(kind => [kind, EARTH_HAZARD_LABELS[kind]] as [string, string])], this.hazard)}</select></label><label>Region<select data-earth-filter="region" aria-label="Region">${options([['all', 'All regions'], ...regions.map(region => [region, region] as [string, string])], this.region)}</select></label><label>Severity<select data-earth-filter="severity" aria-label="Severity">${options([['all', 'All severities'], ['extreme', 'Extreme'], ['severe', 'Severe'], ['moderate', 'Moderate'], ['minor', 'Minor'], ['unknown', 'Unknown']], this.severity)}</select></label><label>Time window<select data-earth-filter="hours" aria-label="Time window">${options([['0', 'All available'], ['24', 'Last 24 hours'], ['72', 'Last 3 days'], ['168', 'Last 7 days']], this.hours)}</select></label></div>${this.hazard !== 'all' && HAZARD_COVERAGE[this.hazard as EarthHazard] ? safeHtml`<p class="earth-coverage-note">${HAZARD_COVERAGE[this.hazard as EarthHazard]}${this.dataset === 'events' ? ' Official warnings are listed in Earth alerts.' : ''}</p>` : ''}${selected ? this.renderDetail(selected) : ''}${joinSafeHtml(sources.filter(e => e.status === 'unavailable').map(unavailable))}<p class="earth-note">${items.length} matching events in available coverage</p>${items.length ? joinSafeHtml(items.slice(0, this.limit).map(item => safeHtml`<article class="earth-card" data-earth-event="${item.id}"><div class="earth-tags"><span class="earth-tag" data-mode="${item.mode}">${item.mode === 'warning' ? 'Official alert' : item.mode === 'forecast' ? 'Forecast' : 'Observed / tracked'}</span><span class="earth-tag" data-severity="${item.severity}">${item.severity} severity</span><span>${hazardLabels(item)}</span></div><h3>${item.title}</h3><div class="earth-meta">${item.provider} · ${item.region} · ${time(item.observedAt)}</div><p>${item.status}${item.magnitude !== undefined ? ` · M ${number(item.magnitude)}` : ''}${item.depthKm !== undefined ? ` · Depth ${number(item.depthKm)} km` : ''}</p><div class="earth-actions"><button type="button" data-earth-details="${item.id}" aria-label="Details: ${item.title}" aria-expanded="${selected?.id === item.id}">Details</button><a href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a></div></article>`)) : safeHtml`<p class="earth-empty">No events match these filters in the available feeds. This is not a global all-clear.</p>`}${this.more(items.length)}`;
  }
  private renderHazardBrowse(items: EarthEvent[]): SafeHtml {
    return safeHtml`<details class="earth-hazard-browse" ${EXTENDED_HAZARDS.includes(this.hazard as EarthHazard) ? safeHtml`open` : ''}><summary>Explore extended hazards</summary><p class="earth-note">Available records before filters. Counts reflect these feeds and their coverage, not the number of hazards worldwide. A record can have several hazard tags.</p><div class="earth-hazard-grid" aria-label="Extended hazard coverage">${joinSafeHtml(EXTENDED_HAZARDS.map(kind => {
      const count = items.filter(item => item.kind === kind || item.hazards?.includes(kind)).length;
      return safeHtml`<button type="button" data-earth-browse="${kind}" aria-label="Browse ${EARTH_HAZARD_LABELS[kind]}" aria-pressed="${this.hazard === kind}"><span>${EARTH_HAZARD_LABELS[kind]}</span><strong>${count}</strong></button>`;
    }))}</div></details>`;
  }
  private renderDetail(item: EarthEvent): SafeHtml {
    const news = this.envelope<EarthItems<EarthNewsItem>>('news');
    const related = relatedEarthNews(item, news?.data?.items || []);
    return safeHtml`<section class="earth-details" aria-label="Selected Earth event" tabindex="-1" data-earth-selected="${item.id}"><div class="earth-tags"><span class="earth-tag" data-mode="${item.mode}">${item.mode}</span><span class="earth-tag">${item.severity} severity</span></div><h3>${item.title}</h3><p class="earth-note">${hazardLabels(item)}</p><p>${item.summary}</p><div class="earth-meta">${item.provider} · ${item.region}<br>Observed / issued ${time(item.observedAt)}${item.expiresAt !== null ? safeHtml`<br>Expires ${time(item.expiresAt)}` : ''}${item.latitude !== null && item.longitude !== null ? safeHtml`<br>${item.locationApproximate ? 'Approximate alert area center' : 'Reported location'} ${number(item.latitude, 3)}, ${number(item.longitude, 3)}` : safeHtml`<br>No point location supplied; no map marker shown.`}</div><div class="earth-actions"><a href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">Original source ↗</a>${item.latitude !== null && item.longitude !== null ? safeHtml`<button type="button" data-earth-map="${item.id}">Show event on map</button><button type="button" data-earth-nearby="${item.id}">Nearby webcams</button>` : ''}<button type="button" data-earth-close>Close details</button></div><h4>Related reporting</h4><p class="earth-note">Matching source links are identified below. Other matches share a hazard and region and provide context; they do not confirm this event.</p>${news ? safeHtml`<p class="earth-note">News ${label(news.status)} · fetched ${time(news.fetchedAt)}</p>` : ''}${related.length ? joinSafeHtml(related.map(({ item: story, exact }) => safeHtml`<div><span class="earth-meta">${exact ? 'Matching source reference' : 'Regional hazard context'}</span>${newsCard(story)}</div>`)) : safeHtml`<p class="earth-note">${news?.status === 'unavailable' ? 'News coverage is unavailable.' : 'No matching reporting in the current feed.'}</p>`}</section>`;
  }
  private renderNews(e: EarthEnvelope<EarthItems<EarthNewsItem>>): SafeHtml {
    const all = e.data!.items;
    const items = all.filter(item => (this.hazard === 'all' || item.kind === this.hazard || item.hazards?.includes(this.hazard as EarthHazard)) && (this.region === 'all' || item.region === this.region)
      && (this.newsSource === 'all' || item.official === (this.newsSource === 'official')));
    const regions = [...new Set(all.map(item => item.region))].sort();
    return safeHtml`<div class="earth-toolbar"><label>News hazard<select data-earth-filter="hazard" aria-label="News hazard">${options([['all', 'All hazards'], ...EARTH_HAZARDS.map(kind => [kind, EARTH_HAZARD_LABELS[kind]] as [string, string])], this.hazard)}</select></label><label>News region<select data-earth-filter="region" aria-label="News region">${options([['all', 'All regions'], ...regions.map(region => [region, region] as [string, string])], this.region)}</select></label><label>News source<select data-earth-filter="source" aria-label="News source">${options([['all', 'All sources'], ['official', 'Official updates'], ['reporting', 'Reporting']], this.newsSource)}</select></label></div><p class="earth-note">${items.length} articles · Topics and regions are source tags or headline classifications. Grouped links consolidate duplicate coverage.</p>${items.length ? joinSafeHtml(items.slice(0, this.limit).map(newsCard)) : safeHtml`<p class="earth-empty">No articles match these filters in the available coverage.</p>`}${this.more(items.length)}`;
  }
  private renderWeather(e: EarthEnvelope<EarthItems<EarthWeatherItem>>): SafeHtml {
    const items = e.data!.items;
    const item = items.find(row => row.id === this.location) || items[0];
    if (!item) return safeHtml`<p class="earth-empty">No weather locations returned by the provider.</p>`;
    const { current, forecast } = currentEarthWeather(item);
    return safeHtml`<label class="earth-toolbar">Weather location<select data-earth-filter="location" aria-label="Weather location">${options(items.map(row => [row.id, `${row.name} · ${row.region}`]), item.id)}</select></label><p class="earth-note">MET Norway modelled conditions and forecast. These are not station observations. Location coverage is limited to the selectable places.</p><h3>${item.name}</h3><p class="earth-meta">Model updated ${time(item.modelRunAt)} · Conditions valid ${time(current?.time)}</p>${current ? safeHtml`<div class="earth-stats"><div class="earth-stat"><strong>${number(current.temperatureC)} °C</strong><span>Temperature</span></div><div class="earth-stat"><strong>${number(current.windKmh)} km/h</strong><span>Wind</span></div><div class="earth-stat"><strong>${number(current.precipitationMm)} mm</strong><span>Precipitation / next hour</span></div></div><p>${current.symbol.replace(/_/g, ' ')}</p>` : safeHtml`<p class="earth-empty">The cached model has no forecast interval covering the current hour. Current conditions are unavailable.</p>`}<h4>Forecast</h4><div class="earth-table-wrap"><table class="earth-table"><thead><tr><th>Valid time (UTC)</th><th>°C</th><th>Wind km/h</th><th>Rain mm</th></tr></thead><tbody>${joinSafeHtml(forecast.slice(0, 12).map(point => safeHtml`<tr><td>${time(point.time)}</td><td>${number(point.temperatureC)}</td><td>${number(point.windKmh)}</td><td>${number(point.precipitationMm)}</td></tr>`))}</tbody></table></div><p><a href="${safeUrlAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Forecast source ↗</a> · <a href="https://www.met.no/en/free-meteorological-data/Licensing-and-crediting" target="_blank" rel="noopener noreferrer">MET Norway · CC BY 4.0</a></p>`;
  }
  private renderRivers(e: EarthEnvelope<EarthItems<EarthRiverItem>>): SafeHtml {
    const items = e.data!.items;
    return safeHtml`<p class="earth-note">Selected US NOAA river gauges. Gauge stage is a measured water level relative to a local datum, not water depth. Thresholds and units vary by gauge.</p>${items.length ? joinSafeHtml(items.map(item => safeHtml`<article class="earth-card"><h3>${item.name}</h3><div class="earth-stats"><div class="earth-stat"><strong>${number(item.stage)} ${item.unit}</strong><span>Observed stage</span></div><div class="earth-stat"><strong>${item.floodCategory}</strong><span>Provider category</span></div></div><p class="earth-meta">${item.region} · Observed ${time(item.observedAt)}</p><p class="earth-note">Thresholds (${item.unit}): action ${number(item.thresholds.action)} · minor ${number(item.thresholds.minor)} · moderate ${number(item.thresholds.moderate)} · major ${number(item.thresholds.major)}</p><a href="${safeUrlAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">NOAA gauge and forecast ↗</a></article>`)) : safeHtml`<p class="earth-empty">No current gauge readings in available coverage.</p>`}`;
  }
  private renderAirQuality(e: EarthEnvelope<EarthItems<EarthAirQualityItem>>): SafeHtml {
    const items = e.data!.items;
    return safeHtml`<p class="earth-note">Selected city observations from the existing air-quality feed. Poor air quality alone does not identify wildfire smoke as its cause.</p>${items.length ? joinSafeHtml(items.map(item => safeHtml`<article class="earth-card"><h3>${item.name} · ${item.countryCode}</h3><div class="earth-stats"><div class="earth-stat"><strong>${number(item.aqi, 0)}</strong><span>AQI</span></div><div class="earth-stat"><strong>${number(item.pm25)}</strong><span>PM2.5 µg/m³</span></div></div><p>${item.riskLevel}</p><p class="earth-meta">${item.provider} · ${item.region} · Observed ${time(item.observedAt)}</p><a href="${safeUrlAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Air-quality source ↗</a></article>`)) : safeHtml`<p class="earth-empty">No current city readings in available coverage.</p>`}`;
  }
  private renderHealth(e: EarthEnvelope<EarthHealthData>): SafeHtml {
    return safeHtml`<p class="earth-note">Retrieval health describes the feeds below, not worldwide hazard coverage. A recent fetch may contain older observations or publications.</p>${joinSafeHtml(e.data!.items.map(item => safeHtml`<article class="earth-card"><h3>${item.dataset}</h3>${source(item)}</article>`))}<button type="button" data-earth-retry>Refresh status</button>`;
  }
  private more(total: number): SafeHtml { return total > this.limit ? safeHtml`<button type="button" data-earth-more>Show 30 more (${Math.min(total, this.limit)} of ${total})</button>` : safeHtml``; }
  override destroy(): void {
    this.stopped = true; this.poll?.stop(); if (this.freshnessTimer) clearInterval(this.freshnessTimer); super.destroy();
  }
}
