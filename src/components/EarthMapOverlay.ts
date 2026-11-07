import { fetchEarthDataset, ageEarthEnvelope } from '@/services/earth';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import type { EarthEnvelope, EarthEvent } from '@/types/earth';
import { EARTH_CAMERAS } from '@/config/earth-cameras';
import { earthEventMarker, EARTH_MARKER_EVENT, type EarthMapMarker, type EarthMapSnapshot } from '@/types/earth-map';
import { loadFromStorage, saveToStorage } from '@/utils';
import { safeHtml, safeUrlAttr, joinSafeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { selectEarthMarker } from './earth-map-interaction';
import './earth-map.css';

const HAZARDS = ['earthquake', 'flood', 'wildfire', 'storm', 'volcano', 'tsunami', 'weather', 'other'] as const;
const PREFS_KEY = 'planetslam-earth-map-v1';
type EventData = { items: EarthEvent[] };

/** Earth keeps event ingestion off the global bootstrap and owns its map data. */
export class EarthMapOverlay {
  private readonly controls = document.createElement('details');
  private readonly abort = new AbortController();
  private readonly observer: MutationObserver;
  private readonly poll: SmartPollLoopHandle;
  private readonly snapshots = new Map<string, EarthEnvelope<EventData>>();
  private enabled: Set<string>;
  private selected: EarthMapMarker | null = null;
  private destroyed = false;

  constructor(private container: HTMLElement, private paint: (snapshot: EarthMapSnapshot) => void,
    private center: (latitude: number, longitude: number) => void) {
    const saved = loadFromStorage<string[]>(PREFS_KEY, [...HAZARDS, 'camera']);
    this.enabled = new Set(Array.isArray(saved) ? saved.filter(v => [...HAZARDS, 'camera'].includes(v as typeof HAZARDS[number])) : [...HAZARDS, 'camera']);
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
      }
    }, { signal: this.abort.signal });
    this.controls.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-earth-retry]')) void this.refresh(true);
    }, { signal: this.abort.signal });
    window.addEventListener(EARTH_MARKER_EVENT, event => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !['event', 'camera'].includes(detail.kind) || typeof detail.id !== 'string') return;
      const marker = this.allMarkers().find(m => m.kind === detail.kind && m.id === detail.id);
      if (!marker) return;
      this.selected = marker; this.controls.open = true;
      this.center(marker.latitude, marker.longitude);
      if (detail.origin === 'panel' && !detail.nearby) this.container.scrollIntoView({ block: 'nearest' });
      this.render();
    }, { signal: this.abort.signal });
    this.observer = new MutationObserver(() => this.attach());
    this.observer.observe(container, { childList: true });
    this.render(); this.attach();
    this.poll = startSmartPollLoop(() => this.refresh(), { intervalMs: 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true });
  }
  private attach(): void { if (!this.destroyed && this.controls.parentElement !== this.container) this.container.append(this.controls); }
  private events(): EarthEvent[] {
    const now = Date.now();
    return [...this.snapshots.values()].flatMap(snapshot => {
      const value = ageEarthEnvelope(snapshot, now);
      return value.status !== 'unavailable' ? value.data?.items.filter(item => !item.expiresAt || item.expiresAt > now) ?? [] : [];
    });
  }
  private allMarkers(): EarthMapMarker[] {
    const events = this.events().map(earthEventMarker).filter((marker): marker is EarthMapMarker => marker !== null);
    const cameras: EarthMapMarker[] = EARTH_CAMERAS.map(camera => ({ id: camera.id, kind: 'camera', title: camera.title,
      latitude: camera.latitude, longitude: camera.longitude, hazard: 'camera', mode: 'context', severity: 'unknown' }));
    return [...events, ...cameras];
  }
  private snapshot(): EarthMapSnapshot { return { markers: this.allMarkers().filter(marker => this.enabled.has(marker.hazard)) }; }
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
    const snapshot = this.snapshot();
    if (this.selected) this.selected = this.allMarkers().find(m => m.kind === this.selected?.kind && m.id === this.selected?.id) ?? null;
    const event = this.selected?.kind === 'event' ? this.events().find(e => e.id === this.selected!.id) : null;
    const camera = this.selected?.kind === 'camera' ? EARTH_CAMERAS.find(c => c.id === this.selected!.id) : null;
    const missing = this.events().filter(e => e.latitude === null || e.longitude === null).length;
    const selection = this.selected ? safeHtml`<section class="earth-map-selection" aria-label="Selected map location"><strong>${this.selected.title}</strong><p>${event ? `${event.mode} · ${event.kind} · ${event.severity} · ${event.provider}` : 'Webcam location · playback checked when connected'}</p><a href="${safeUrlAttr(event?.url || camera?.sourceUrl || '')}" target="_blank" rel="noopener noreferrer">Open original source ↗</a></section>` : '';
    setTrustedHtml(this.controls, trustedHtml(safeHtml`<summary>Earth layers · ${snapshot.markers.length} locations</summary>
      <p>Amber: observed · red: warning · violet: forecast · teal: webcam</p>
      <div class="earth-map-toggles">${joinSafeHtml([...HAZARDS, 'camera'].map(hazard => safeHtml`<label><input type="checkbox" data-earth-layer value="${hazard}" ${this.enabled.has(hazard) ? safeHtml`checked` : ''}>${hazard === 'camera' ? 'Webcams' : hazard[0]!.toUpperCase() + hazard.slice(1)}</label>`))}</div>
      <label>Inspect Earth location<select aria-label="Inspect Earth location" data-earth-inspect><option value="">Choose an event or camera…</option>${joinSafeHtml(snapshot.markers.map(marker => safeHtml`<option value="${marker.kind}:${marker.id}" ${this.selected?.id === marker.id && this.selected.kind === marker.kind ? safeHtml`selected` : ''}>${marker.kind === 'camera' ? 'Camera' : marker.hazard}: ${marker.title}</option>`))}</select></label>
      ${selection}<p role="status">${[...this.snapshots.entries()].map(([name, value]) => `${name}: ${ageEarthEnvelope(value).status}`).join(' · ') || 'Loading event sources…'}</p>
      <small>${missing} events without coordinates remain in the lists. Locations may be approximate. Radar is available on the desktop flat map; coverage varies.</small><button type="button" data-earth-retry>Refresh map data</button>`.toString(), 'Earth labels are escaped with safeHtml and links pass safeUrlAttr.'));
    this.paint(snapshot);
  }
  destroy(): void {
    this.destroyed = true; this.poll.stop(); this.abort.abort(); this.observer.disconnect(); this.controls.remove(); this.paint({ markers: [] });
  }
}
