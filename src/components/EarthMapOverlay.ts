import { fetchEarthDataset, ageEarthEnvelope, earthHistoryEvents } from '@/services/earth';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import { EARTH_HAZARDS, EARTH_HAZARD_LABELS, type EarthEnvelope, type EarthEvent, type EarthHistoryData, type EarthHistoryFrame } from '@/types/earth';
import { EARTH_CAMERAS } from '@/config/earth-cameras';
import { earthEventMarker, EARTH_MARKER_EVENT, type EarthMapMarker, type EarthMapSnapshot } from '@/types/earth-map';
import { loadFromStorage, saveToStorage } from '@/utils';
import { safeHtml, safeUrlAttr, joinSafeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { selectEarthMarker } from './earth-map-interaction';
import './earth-map.css';

const PREFS_KEY = 'planetslam-earth-map-v1';
type EventData = { items: EarthEvent[] };

/** Demand-loaded current sources and a separate recorded timeline, shared by all renderers. */
export class EarthMapOverlay {
  private readonly controls = document.createElement('details');
  private readonly abort = new AbortController();
  private readonly observer: MutationObserver;
  private readonly poll: SmartPollLoopHandle;
  private readonly snapshots = new Map<string, EarthEnvelope<EventData>>();
  private enabled: Set<string>;
  private selected: EarthMapMarker | null = null;
  private destroyed = false;
  private history: EarthEnvelope<EarthHistoryData> | null = null;
  private historical = false;
  private historyLoading = false;
  private historyError = '';
  private frameTime: number | null = null;
  private playback: ReturnType<typeof setInterval> | null = null;

  constructor(private container: HTMLElement, private paint: (snapshot: EarthMapSnapshot) => void,
    private center: (latitude: number, longitude: number) => void) {
    const saved = loadFromStorage<string[]>(PREFS_KEY, [...EARTH_HAZARDS, 'camera']);
    this.enabled = new Set(Array.isArray(saved) ? saved.filter(v => [...EARTH_HAZARDS, 'camera'].includes(v as typeof EARTH_HAZARDS[number])) : [...EARTH_HAZARDS, 'camera']);
    if (!loadFromStorage<boolean>('planetslam-earth-map-extended-v1', false)) {
      for (const hazard of EARTH_HAZARDS.filter(kind => !['earthquake', 'flood', 'wildfire', 'storm', 'volcano', 'tsunami', 'weather', 'other'].includes(kind))) this.enabled.add(hazard);
      saveToStorage('planetslam-earth-map-extended-v1', true);
      saveToStorage(PREFS_KEY, [...this.enabled]);
    }
    this.controls.className = 'earth-map-controls';
    this.controls.dataset.testid = 'earth-map-controls';
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick', 'keydown', 'keyup', 'wheel']) this.controls.addEventListener(name, e => e.stopPropagation(), { signal: this.abort.signal });
    this.controls.addEventListener('change', event => {
      const input = event.target as HTMLInputElement | HTMLSelectElement;
      if (input.matches('[data-earth-layer]')) {
        if ((input as HTMLInputElement).checked) this.enabled.add(input.value); else this.enabled.delete(input.value);
        saveToStorage(PREFS_KEY, [...this.enabled]); this.render();
      } else if (input.matches('[data-earth-inspect]')) {
        const marker = this.snapshot().markers.find(m => `${m.kind}:${m.id}` === input.value);
        if (marker) selectEarthMarker(marker);
      } else if (input.matches('[data-earth-frame]')) {
        this.stopPlayback(); this.frameTime = this.frames()[Number(input.value)]?.recordedAt ?? null;
        this.selected = null; this.render();
      }
    }, { signal: this.abort.signal });
    this.controls.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-earth-retry]')) void this.refresh(true);
      if (target.closest('[data-earth-history]')) void this.loadHistory();
      if (target.closest('[data-earth-current]')) { this.historical = false; this.selected = null; this.stopPlayback(); this.render(); }
      if (target.closest('[data-earth-play]')) this.togglePlayback();
    }, { signal: this.abort.signal });
    this.controls.addEventListener('toggle', () => { if (!this.controls.open && this.playback) { this.stopPlayback(); this.render(); } }, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.stopPlayback(); this.render(); } }, { signal: this.abort.signal });
    const select = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !['event', 'camera'].includes(detail.kind) || typeof detail.id !== 'string') return;
      if (event.type === EARTH_MARKER_EVENT && this.historical) { this.historical = false; this.stopPlayback(); }
      const marker = this.allMarkers().find(m => m.kind === detail.kind && m.id === detail.id);
      if (!marker) return;
      this.selected = marker; this.controls.open = true;
      this.center(marker.latitude, marker.longitude);
      if (detail.origin === 'panel' && !detail.nearby) this.container.scrollIntoView({ block: 'nearest' });
      this.render();
    };
    window.addEventListener('planetslam:earth-location', event => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !Number.isFinite(detail.latitude) || !Number.isFinite(detail.longitude) || Math.abs(detail.latitude) > 90 || Math.abs(detail.longitude) > 180) return;
      this.historical = false; this.selected = null; this.stopPlayback();
      this.center(detail.latitude, detail.longitude); this.render();
      this.container.scrollIntoView({ block: 'nearest' });
    }, { signal: this.abort.signal });
    window.addEventListener(EARTH_MARKER_EVENT, select, { signal: this.abort.signal });
    window.addEventListener('planetslam:earth-history-select', select, { signal: this.abort.signal });
    this.observer = new MutationObserver(() => this.attach());
    this.observer.observe(container, { childList: true });
    this.render(); this.attach();
    this.poll = startSmartPollLoop(() => this.refresh(), { intervalMs: 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true });
  }
  private attach(): void { if (!this.destroyed && this.controls.parentElement !== this.container) this.container.append(this.controls); }
  private frames(): EarthHistoryFrame[] { return this.history ? ageEarthEnvelope(this.history).data?.items ?? [] : []; }
  private frame(): EarthHistoryFrame | null { return this.frames().find(frame => frame.recordedAt === this.frameTime) ?? null; }
  private events(): EarthEvent[] {
    if (this.historical) {
      const frame = this.frame(), data = this.history && ageEarthEnvelope(this.history).data;
      return frame && data ? earthHistoryEvents(data, frame) : [];
    }
    const now = Date.now();
    return [...this.snapshots.values()].flatMap(snapshot => {
      const value = ageEarthEnvelope(snapshot, now);
      return value.status !== 'unavailable' ? value.data?.items.filter(item => !item.expiresAt || item.expiresAt > now) ?? [] : [];
    });
  }
  private allMarkers(): EarthMapMarker[] {
    const events = this.events().map(event => {
      const marker = earthEventMarker(event);
      return marker && this.historical ? { ...marker, recordedAt: this.frameTime! } : marker;
    }).filter((marker): marker is EarthMapMarker => marker !== null);
    if (this.historical) return events;
    const cameras: EarthMapMarker[] = EARTH_CAMERAS.map(camera => ({ id: camera.id, kind: 'camera', title: camera.title,
      latitude: camera.latitude, longitude: camera.longitude, hazard: 'camera', mode: 'context', severity: 'unknown' }));
    return [...events, ...cameras];
  }
  private snapshot(): EarthMapSnapshot {
    const events = new Map(this.events().map(event => [event.id, event]));
    return { markers: this.allMarkers().filter(marker => this.enabled.has(marker.hazard)
      || events.get(marker.id)?.hazards?.some(hazard => this.enabled.has(hazard))) };
  }
  private async loadHistory(): Promise<void> {
    if (this.historyLoading) return;
    this.historyLoading = true; this.historyError = ''; this.stopPlayback(); this.render();
    try {
      const value = await fetchEarthDataset<EarthHistoryData>('history', true);
      if (this.destroyed) return;
      this.history = value;
      this.historical = true; this.selected = null;
      this.frameTime = this.frames()[0]?.recordedAt ?? null;
    } catch { this.historyError = 'Recorded history unavailable. Try again.'; }
    finally { this.historyLoading = false; this.render(); }
  }
  private stopPlayback(): void { if (this.playback) clearInterval(this.playback); this.playback = null; }
  private togglePlayback(): void {
    if (this.playback) { this.stopPlayback(); this.render(); return; }
    const frames = this.frames();
    if (frames.length < 2) return;
    if (this.frameTime === frames[frames.length - 1]?.recordedAt) this.frameTime = frames[0]!.recordedAt;
    this.playback = setInterval(() => {
      const current = this.frames();
      const next = current.find(frame => frame.recordedAt > (this.frameTime ?? 0));
      if (!next || document.hidden || !this.controls.open) { this.stopPlayback(); this.render(); return; }
      this.frameTime = next.recordedAt; this.selected = null;
      if (next.recordedAt === current[current.length - 1]?.recordedAt) this.stopPlayback();
      this.render();
    }, 1500);
    this.render();
  }
  private async refresh(force = false): Promise<void> {
    const names = ['earthquakes', 'events', 'alerts'] as const;
    const results = await Promise.allSettled(names.map(dataset => fetchEarthDataset<EventData>(dataset, force)));
    if (this.destroyed) return;
    results.forEach((result, index) => {
      const name = names[index]!;
      if (result.status === 'fulfilled') this.snapshots.set(name, result.value);
      else this.snapshots.delete(name);
    });
    this.render();
  }
  private render(): void {
    if (this.destroyed) return;
    const layersOpen = this.controls.querySelector<HTMLDetailsElement>('.earth-map-layer-options')?.open ?? false;
    const active = document.activeElement;
    const focusKey = this.controls.contains(active)
      ? ['data-earth-frame', 'data-earth-play', 'data-earth-history', 'data-earth-inspect'].find(attribute => active?.hasAttribute(attribute)) : undefined;
    const snapshot = this.snapshot();
    if (this.selected) this.selected = snapshot.markers.find(m => m.kind === this.selected?.kind && m.id === this.selected?.id) ?? null;
    const event = this.selected?.kind === 'event' ? this.events().find(e => e.id === this.selected!.id) : null;
    const camera = this.selected?.kind === 'camera' ? EARTH_CAMERAS.find(c => c.id === this.selected!.id) : null;
    const missing = this.events().filter(e => e.latitude === null || e.longitude === null).length;
    const frames = this.frames(), frame = this.frame();
    const timeline = this.historical ? safeHtml`<section class="earth-history" aria-label="Earth event history"><strong>Historical snapshots · not current alerts</strong>
      ${frames.length ? safeHtml`<p>Retained ${new Date(frames[0]!.recordedAt).toLocaleString()} – ${new Date(frames[frames.length - 1]!.recordedAt).toLocaleString()} · ${frames.length} recorded states</p>
      <label>Recorded snapshot<input type="range" data-earth-frame aria-label="Recorded snapshot" min="0" max="${frames.length - 1}" value="${Math.max(0, frames.findIndex(item => item.recordedAt === this.frameTime))}" step="1"></label>
      <output data-earth-recorded>${frame ? new Date(frame.recordedAt).toLocaleString() : 'Selected snapshot expired; reload history'}</output>
      <button type="button" data-earth-play ${frames.length < 2 ? safeHtml`disabled` : ''}>${this.playback ? 'Pause playback' : 'Play history'}</button>
      <p>${frame ? `${frame.eventKeys.length} of ${frame.totalEvents} retained events${frame.truncated ? ' · capacity limited' : ''}` : 'No snapshot selected'}. Hourly recorded states; gaps are not reconstructed. Up to 7 days, bounded by archive capacity.</p>
      ${frame ? safeHtml`<details><summary>Sources at this recorded time</summary>${joinSafeHtml(frame.sources.map(source => safeHtml`<p>${source.provider}: ${source.status} · fetched ${source.fetchedAt ? new Date(source.fetchedAt).toLocaleString() : 'unavailable'} · ${source.coverage}</p>`))}</details>` : ''}` : safeHtml`<p>No retained snapshots available. History begins when the upgraded worker runs; it is not backfilled.</p>`}
      ${frame ? safeHtml`<details><summary>Recorded events (${frame.eventKeys.length})</summary><ul class="earth-history-records">${joinSafeHtml(this.events().map(item => safeHtml`<li><a href="${safeUrlAttr(item.url)}" target="_blank" rel="noopener noreferrer">${item.title}</a><small>${item.mode} · ${item.kind} · ${item.provider} · source event ${new Date(item.observedAt).toLocaleString()}${item.latitude === null || item.longitude === null ? ' · no map coordinates' : ''}</small></li>`))}</ul></details>` : ''}
      <button type="button" data-earth-current>Return to current events</button></section>` : '';
    const selection = this.selected ? safeHtml`<section class="earth-map-selection" aria-label="Selected map location"><strong>${this.selected.title}</strong><p>${this.historical ? 'Historical record · ' : ''}${event ? `${event.mode} · ${event.kind} · ${event.severity} · ${event.provider}` : 'Webcam location · playback checked when connected'}</p>${event ? safeHtml`<p>${event.summary}</p><small>Source event time: ${new Date(event.observedAt).toLocaleString()}${event.expiresAt ? ` · original expiry: ${new Date(event.expiresAt).toLocaleString()}` : ''}</small>` : ''}<a href="${safeUrlAttr(event?.url || camera?.sourceUrl || '')}" target="_blank" rel="noopener noreferrer">Open original source ↗</a></section>` : '';
    setTrustedHtml(this.controls, trustedHtml(safeHtml`<summary>Earth layers${this.historical ? ' · HISTORY' : ''} · ${snapshot.markers.length} locations</summary>
      <p>Amber: observed · red: warning · violet: forecast · teal: webcam</p>
      <button type="button" data-earth-history ${this.historyLoading ? safeHtml`disabled` : ''}>${this.historyLoading ? 'Loading history…' : this.historical ? 'Reload recorded history' : 'Explore event history'}</button>
      ${this.historyError ? safeHtml`<p role="alert">${this.historyError}</p>` : ''}${timeline}
      <details class="earth-map-layer-options" ${layersOpen ? safeHtml`open` : ''}><summary>Hazard layers</summary><div class="earth-map-toggles">${joinSafeHtml([...EARTH_HAZARDS, 'camera'].map(hazard => safeHtml`<label><input type="checkbox" data-earth-layer value="${hazard}" ${this.enabled.has(hazard) ? safeHtml`checked` : ''}>${hazard === 'camera' ? 'Webcams' : EARTH_HAZARD_LABELS[hazard as keyof typeof EARTH_HAZARD_LABELS]}</label>`))}</div></details>
      <label>Inspect Earth location<select aria-label="Inspect Earth location" data-earth-inspect><option value="">Choose an event${this.historical ? '' : ' or camera'}…</option>${joinSafeHtml(snapshot.markers.map(marker => safeHtml`<option value="${marker.kind}:${marker.id}" ${this.selected?.id === marker.id && this.selected.kind === marker.kind ? safeHtml`selected` : ''}>${marker.kind === 'camera' ? 'Camera' : marker.hazard}: ${marker.title}</option>`))}</select></label>
      ${selection}<p role="status">${this.historical ? `Historical archive: ${this.history ? ageEarthEnvelope(this.history).status : 'unavailable'}` : [...this.snapshots.entries()].map(([name, value]) => `${name}: ${ageEarthEnvelope(value).status}`).join(' · ') || 'Loading event sources…'}</p>
      <small>${missing} events without coordinates remain in the lists. Locations may be approximate. Precipitation radar is current and available on the 2D WebGL map. Globe/mobile show event locations; satellite cloud imagery is not supplied. Recorded playback does not rewind radar.</small><button type="button" data-earth-retry>Refresh current map data</button>`.toString(), 'Earth labels are escaped with safeHtml and links pass safeUrlAttr.'));
    if (focusKey) this.controls.querySelector<HTMLElement>(`[${focusKey}]`)?.focus({ preventScroll: true });
    this.paint(snapshot);
  }
  destroy(): void {
    this.destroyed = true; this.stopPlayback(); this.poll.stop(); this.abort.abort(); this.observer.disconnect(); this.controls.remove(); this.paint({ markers: [] });
  }
}
