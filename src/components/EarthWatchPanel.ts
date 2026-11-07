import { Panel } from './Panel';
import { ageEarthEnvelope, fetchEarthDataset, publishEarthSelection } from '@/services/earth';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/smart-poll-loop';
import {
  buildEarthDailyBrief, evaluateEarthWatch, getEarthWatchMatches,
  loadEarthWatchPreferences, loadEarthWatchState, saveEarthWatchPreferences, saveEarthWatchState,
} from '@/services/earth-watch';
import type { EarthSavedLocation, EarthWatchPreferences, EarthWatchMatch, EarthWatchChange } from '@/types/earth-watch';
import { EARTH_HAZARDS, EARTH_HAZARD_LABELS, type EarthDataset, type EarthEnvelope, type EarthEvent, type EarthItems, type EarthSource } from '@/types/earth';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';
import './earth-watch.css';

const DATASETS: EarthDataset[] = ['earthquakes', 'events', 'alerts', 'changes'];
const time = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value)
  ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Unavailable';
const changeLabels: Record<EarthWatchChange['type'], string> = {
  new: 'New matching event', escalated: 'Severity increased', updated: 'Provider update', expired: 'Original alert expired',
  cancelled: 'Cancelled by provider', closed: 'Closed by provider', recovered: 'Recovery reported by provider', missing: 'No longer listed · outcome unknown',
};
const sourceLabel = (source: EarthSource): string => source.status === 'fresh' ? 'Updated' : source.status === 'stale' ? 'Delayed' : 'Unavailable';
const options = (values: readonly [string, string][], selected: string): SafeHtml => joinSafeHtml(values.map(([value, text]) => safeHtml`<option value="${value}" ${value === selected ? safeHtml`selected` : ''}>${text}</option>`));

/** Browser-local personal watch. It never requests location or sends external notifications on startup. */
export class EarthWatchPanel extends Panel {
  private preferences = loadEarthWatchPreferences();
  private watchState = loadEarthWatchState();
  private latest: Partial<Record<EarthDataset, EarthEnvelope<EarthItems<EarthEvent>>>> = {};
  private matches: EarthWatchMatch[] = [];
  private poll: SmartPollLoopHandle | null = null;
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private loading = false;
  private loaded = false;
  private message = '';
  private messageError = false;
  private locating = false;
  private locationFormOpen = false;
  private settingsOpen = false;
  private draftLocation = { name: '', latitude: '', longitude: '' };
  private draftPreferences: EarthWatchPreferences;
  private pendingRender = false;
  private nearbyLimit = 10;

  constructor(id = 'earth-watch', title = 'My Earth') {
    super({ id, title, className: 'earth-watch-panel', defaultRowSpan: 3,
      infoTooltip: 'Saved places, source-attributed nearby hazards and browser-local alerts. Updates run while this dashboard is open. Coverage varies by provider.' });
    this.draftPreferences = structuredClone(this.preferences);
    this.locationFormOpen = !this.preferences.locations.length;
    this.render(true);
    this.content.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      if (form.hasAttribute('data-earth-location-form')) this.addLocation();
      else if (form.hasAttribute('data-earth-watch-settings')) this.applySettings();
    }, { signal: this.signal });
    this.content.addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      const field = input.dataset.earthLocationField;
      if (field === 'name' || field === 'latitude' || field === 'longitude') this.draftLocation[field] = input.value;
      this.readSettingsDraft();
    }, { signal: this.signal });
    this.content.addEventListener('change', event => {
      const input = event.target as HTMLInputElement | HTMLSelectElement;
      if (input.hasAttribute('data-earth-watch-location')) {
        this.preferences = { ...this.preferences, selectedLocationId: input.value || null };
        this.persistPreferences(); this.nearbyLimit = 10; this.reconcile(); this.render(true);
      } else this.readSettingsDraft();
    }, { signal: this.signal });
    this.content.addEventListener('focusout', () => {
      if (this.pendingRender) queueMicrotask(() => this.render());
    }, { signal: this.signal });
    this.content.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-earth-watch-action], [data-earth-watch-event]');
      if (!target) return;
      if (target.dataset.earthWatchEvent) {
        const item = this.matches.find(match => match.event.id === target.dataset.earthWatchEvent)?.event;
        if (item && item.latitude !== null && item.longitude !== null) publishEarthSelection({ id: item.id, kind: 'event', origin: 'panel', latitude: item.latitude, longitude: item.longitude });
        return;
      }
      switch (target.dataset.earthWatchAction) {
        case 'refresh': void this.refresh(true); break;
        case 'locate': this.useMyLocation(); break;
        case 'remove': this.removeLocation(); break;
        case 'center': {
          const location = this.location();
          if (location) window.dispatchEvent(new CustomEvent('planetslam:earth-location', { detail: { latitude: location.latitude, longitude: location.longitude } }));
          break;
        }
        case 'read': this.watchState = { ...this.watchState, inbox: this.watchState.inbox.map(item => ({ ...item, read: true })) }; this.persistState(); this.render(true); break;
        case 'clear': this.watchState = { ...this.watchState, inbox: [] }; this.persistState(); this.render(true); break;
        case 'more': this.nearbyLimit += 10; this.render(true); break;
      }
    }, { signal: this.signal });
    this.content.addEventListener('toggle', event => {
      const detail = event.target as HTMLDetailsElement;
      if (detail.hasAttribute('data-earth-location-details')) this.locationFormOpen = detail.open;
      if (detail.hasAttribute('data-earth-settings-details')) this.settingsOpen = detail.open;
    }, { signal: this.signal, capture: true });
    this.runWhenConnected(() => {
      this.poll = startSmartPollLoop(() => this.refresh(), { intervalMs: 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true });
      this.freshnessTimer = setInterval(() => {
        if (!document.hidden) { this.reconcile(); this.render(); }
      }, 30_000);
    });
  }

  private location(): EarthSavedLocation | null {
    return this.preferences.locations.find(location => location.id === this.preferences.selectedLocationId) ?? null;
  }
  private persistPreferences(): boolean {
    const saved = saveEarthWatchPreferences(this.preferences);
    if (!saved) { this.message = 'This browser could not save your settings. Check browser storage access.'; this.messageError = true; }
    return saved;
  }
  private persistState(): void {
    if (!saveEarthWatchState(this.watchState)) { this.message = 'Alert history could not be saved in this browser.'; this.messageError = true; }
  }
  private addLocation(): void {
    const name = this.draftLocation.name.trim(), latitudeText = this.draftLocation.latitude.trim(), longitudeText = this.draftLocation.longitude.trim();
    const latitude = latitudeText ? Number(latitudeText) : NaN, longitude = longitudeText ? Number(longitudeText) : NaN;
    if (!name || name.length > 80 || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      this.message = 'Enter a location name and valid latitude (−90 to 90) and longitude (−180 to 180).'; this.messageError = true; this.render(true); return;
    }
    if (this.preferences.locations.length >= 10) { this.message = 'You can save up to 10 locations. Remove one before adding another.'; this.messageError = true; this.render(true); return; }
    const location: EarthSavedLocation = { id: crypto.randomUUID(), name, latitude, longitude };
    this.preferences = { ...this.preferences, locations: [...this.preferences.locations, location], selectedLocationId: location.id };
    const saved = this.persistPreferences(); this.draftLocation = { name: '', latitude: '', longitude: '' }; this.locationFormOpen = false;
    this.message = saved ? `Saved ${name}. Current matches establish a baseline; repeated refreshes do not repeat alerts.` : 'This location is available for this session, but browser storage could not save it.'; this.messageError = !saved;
    this.nearbyLimit = 10; this.reconcile(); this.render(true);
  }
  private removeLocation(): void {
    const current = this.location(); if (!current) return;
    const locations = this.preferences.locations.filter(location => location.id !== current.id);
    this.preferences = { ...this.preferences, locations, selectedLocationId: locations[0]?.id ?? null };
    const saved = this.persistPreferences(); this.message = saved ? `Removed ${current.name}.` : 'Location removed for this session; browser storage could not save the change.'; this.messageError = !saved;
    this.locationFormOpen = !locations.length; this.nearbyLimit = 10; this.reconcile(); this.render(true);
  }
  private useMyLocation(): void {
    if (!navigator.geolocation) { this.message = 'Location access is unavailable. Enter coordinates to save a place.'; this.messageError = true; this.render(true); return; }
    this.locating = true; this.message = 'Waiting for your browser’s location permission…'; this.messageError = false; this.render(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (this.stopped) return;
      this.locating = false; this.locationFormOpen = true;
      this.draftLocation = { name: 'Current location', latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) };
      this.message = 'Coordinates filled in. Choose Save location to use this place for nearby hazards.'; this.messageError = false; this.render(true);
    }, error => {
      if (this.stopped) return;
      this.locating = false; this.message = error.code === 1 ? 'Location permission was denied. You can enter coordinates instead.' : 'Your location could not be obtained. Enter coordinates or try again.';
      this.messageError = true; this.render(true);
    }, { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 });
  }
  private readSettingsDraft(): void {
    const form = this.content.querySelector<HTMLFormElement>('[data-earth-watch-settings]'); if (!form) return;
    const field = (name: string): HTMLInputElement | HTMLSelectElement | null => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    this.draftPreferences = { ...this.preferences,
      radiusKm: Number(field('radius')?.value), minMagnitude: Number(field('magnitude')?.value),
      minSeverity: field('severity')?.value as EarthWatchPreferences['minSeverity'],
      includeUnknown: (field('unknown') as HTMLInputElement | null)?.checked ?? false,
      alertsEnabled: (field('enabled') as HTMLInputElement | null)?.checked ?? false,
      hazards: [...form.querySelectorAll<HTMLInputElement>('[name="hazard"]:checked')].map(input => input.value as EarthEvent['kind']),
    };
  }
  private applySettings(): void {
    this.readSettingsDraft(); const draft = this.draftPreferences;
    if (!Number.isFinite(draft.radiusKm) || draft.radiusKm < 10 || draft.radiusKm > 2000 || !Number.isFinite(draft.minMagnitude) || draft.minMagnitude < 0 || draft.minMagnitude > 9) {
      this.message = 'Use a radius from 10 to 2,000 km and an earthquake magnitude from 0 to 9.'; this.messageError = true; this.render(true); return;
    }
    this.preferences = { ...draft, locations: this.preferences.locations, selectedLocationId: this.preferences.selectedLocationId };
    const saved = this.persistPreferences(); this.nearbyLimit = 10; this.reconcile();
    this.message = saved ? 'Alert settings saved. Existing matches are the new baseline.' : 'Settings apply for this session; browser storage could not save them.'; this.messageError = !saved; this.settingsOpen = false; this.render(true);
  }
  private snapshot(): { events: EarthEvent[]; sources: EarthSource[]; fetchedAt: number | null } {
    const envelopes = DATASETS.flatMap(dataset => this.latest[dataset] ? [ageEarthEnvelope(this.latest[dataset]!)] : []);
    const sources = [...new Map(envelopes.flatMap(envelope => envelope.sources ?? envelope.data?.sources ?? []).map(source => [source.id, source])).values()];
    const events = envelopes.flatMap(envelope => envelope.status !== 'unavailable' ? envelope.data?.items ?? [] : []);
    const times = envelopes.map(envelope => envelope.fetchedAt).filter((value): value is number => value !== null && Number.isFinite(value));
    return { events, sources, fetchedAt: times.length ? Math.max(...times) : null };
  }
  private reconcile(): void {
    if (!this.loaded) return;
    const data = this.snapshot();
    const result = evaluateEarthWatch(this.watchState, this.preferences, data);
    this.watchState = result.state; this.matches = result.matches; this.persistState();
  }
  private async refresh(force = false): Promise<void> {
    if (this.loading || this.stopped) return;
    this.loading = true; this.render();
    try {
      const results = await Promise.allSettled(DATASETS.map(dataset => fetchEarthDataset<EarthItems<EarthEvent>>(dataset, force)));
      if (this.stopped) return;
      results.forEach((result, index) => {
        const dataset = DATASETS[index]!;
        if (result.status === 'fulfilled') this.latest[dataset] = result.value;
        else {
          const prior = this.latest[dataset];
          const sources = (prior?.sources ?? prior?.data?.sources ?? []).map(source => ({ ...source, status: 'unavailable' as const }));
          this.latest[dataset] = { dataset, status: 'unavailable', provider: prior?.provider ?? 'Earth data service', sourceUrl: prior?.sourceUrl ?? '',
            coverage: prior?.coverage ?? 'Coverage unavailable during this interruption.', fetchedAt: prior?.fetchedAt ?? null, observedAt: prior?.observedAt ?? null,
            expiresAt: null, data: null, sources, message: 'Earth data service could not be reached.' };
        }
      });
      this.loaded = true; this.reconcile();
    } finally { this.loading = false; this.render(); }
  }
  private eventCard(match: EarthWatchMatch): SafeHtml {
    const event = match.event;
    return safeHtml`<article class="earth-watch-event"><h4>${event.title}</h4><p class="earth-watch-meta">${event.mode} · ${EARTH_HAZARD_LABELS[event.kind]} · ${event.severity} severity · ${Math.round(match.distanceKm)} km${event.locationApproximate ? ' to approximate alert-area center' : ' from saved coordinates'}</p><p class="earth-watch-meta">${event.provider} · source event ${time(event.observedAt)}${event.expiresAt ? ` · expires ${time(event.expiresAt)}` : ''}</p><div class="earth-watch-actions"><a href="${safeUrlAttr(event.url)}" target="_blank" rel="noopener noreferrer">Original source ↗</a><button type="button" data-earth-watch-event="${event.id}" aria-label="Show ${event.title} on map">Show on map</button></div></article>`;
  }
  private render(force = false): void {
    if (this.stopped) return;
    const active = document.activeElement;
    if (!force && this.content.contains(active) && active?.matches('input, select')) { this.pendingRender = true; return; }
    this.pendingRender = false;
    const location = this.location(), data = this.snapshot(), preferences = this.draftPreferences;
    const unread = this.watchState.inbox.filter(item => !item.read).length;
    const currentSources = data.sources.filter(source => source.status !== 'unavailable');
    const nearby = location ? getEarthWatchMatches(data.events, location, this.preferences) : { matches: [], unlocated: 0 };
    this.matches = nearby.matches;
    const brief = location ? buildEarthDailyBrief(data.events, location, this.preferences, data.sources) : null;
    const locationControls = safeHtml`<section aria-label="Saved Earth locations"><div class="earth-watch-toolbar"><label>Saved location<select aria-label="Saved location" data-earth-watch-location>${options(this.preferences.locations.length ? this.preferences.locations.map(place => [place.id, place.name]) : [['', 'No saved locations']], this.preferences.selectedLocationId ?? '')}</select></label>${location ? safeHtml`<button type="button" data-earth-watch-action="center">Center map on saved location</button><button type="button" data-earth-watch-action="remove">Remove saved location</button>` : ''}</div>${location ? safeHtml`<p class="earth-watch-meta">${location.name} · ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)} · radius ${this.preferences.radiusKm} km</p>` : ''}<details data-earth-location-details ${this.locationFormOpen ? safeHtml`open` : ''}><summary>Add a saved location</summary><form aria-label="Save an Earth location" data-earth-location-form><div class="earth-watch-fields"><label>Location name<input name="name" data-earth-location-field="name" aria-label="Location name" value="${this.draftLocation.name}" required maxlength="80" autocomplete="off"></label><label>Latitude<input name="latitude" data-earth-location-field="latitude" aria-label="Latitude" type="number" min="-90" max="90" step="any" value="${this.draftLocation.latitude}" required></label><label>Longitude<input name="longitude" data-earth-location-field="longitude" aria-label="Longitude" type="number" min="-180" max="180" step="any" value="${this.draftLocation.longitude}" required></label></div><div class="earth-watch-actions"><button type="submit">Save location</button><button type="button" data-earth-watch-action="locate" ${this.locating ? safeHtml`disabled` : ''}>${this.locating ? 'Locating…' : 'Use my location'}</button></div></form></details><p class="earth-watch-note">Saved coordinates and alert history stay in this browser. Location access is requested only when you choose Use my location; coordinates are not sent to a geocoder.</p></section>`;
    const settings = safeHtml`<details data-earth-settings-details ${this.settingsOpen ? safeHtml`open` : ''}><summary>Alert settings</summary><form aria-label="Earth alert settings" data-earth-watch-settings><div class="earth-watch-fields"><label>Radius (km)<input name="radius" aria-label="Radius (km)" type="number" min="10" max="2000" step="1" value="${preferences.radiusKm}" required></label><label>Minimum severity<select name="severity" aria-label="Minimum severity">${options([['all', 'All reported severities'], ['minor', 'Minor or higher'], ['moderate', 'Moderate or higher'], ['severe', 'Severe or higher'], ['extreme', 'Extreme only']], preferences.minSeverity)}</select></label><label>Minimum earthquake magnitude<input name="magnitude" aria-label="Minimum earthquake magnitude" type="number" min="0" max="9" step="0.1" value="${preferences.minMagnitude}" required></label></div><label class="earth-watch-check"><input name="unknown" type="checkbox" ${preferences.includeUnknown ? safeHtml`checked` : ''}>Include unknown severity</label><label class="earth-watch-check"><input name="enabled" type="checkbox" ${preferences.alertsEnabled ? safeHtml`checked` : ''}>Enable in-app alerts</label><fieldset><legend>Hazards to watch</legend><div class="earth-watch-hazards">${joinSafeHtml(EARTH_HAZARDS.map(hazard => safeHtml`<label><input name="hazard" value="${hazard}" type="checkbox" ${preferences.hazards.includes(hazard) ? safeHtml`checked` : ''}>${EARTH_HAZARD_LABELS[hazard]}</label>`))}</div></fieldset><button type="submit">Save alert settings</button></form></details>`;
    const summary = location ? safeHtml`<div class="earth-watch-stats"><div><strong>${nearby.matches.length}</strong><span>Matching nearby events</span></div><div><strong>${unread}</strong><span>Unread in-app alerts</span></div><div><strong>${currentSources.length}/${data.sources.length}</strong><span>Available sources</span></div></div><section aria-label="Daily Earth brief" class="earth-watch-brief"><h3>Daily Earth brief · ${brief!.date} UTC</h3><p class="earth-watch-meta">Updated ${time(brief!.generatedAt)} · source events in the past 24 hours</p><p>${brief!.total} matching events for ${location.name} within ${this.preferences.radiusKm} km.</p><p class="earth-watch-meta">${Object.entries(brief!.counts).map(([kind, count]) => `${count} ${EARTH_HAZARD_LABELS[kind as EarthEvent['kind']]}`).join(' · ') || 'No matching hazard categories in available records'}</p><p class="earth-watch-meta">${brief!.sources.filter(source => source.status === 'fresh').length} updated sources · ${brief!.sources.filter(source => source.status === 'stale').length} delayed · ${brief!.sources.filter(source => source.status === 'unavailable').length} unavailable</p><p class="earth-watch-note">${brief!.coverage}</p>${brief!.items.length ? joinSafeHtml(brief!.items.slice(0, 5).map(match => this.eventCard(match))) : safeHtml`<p class="earth-watch-note">No matching records in this 24-hour window and available coverage. This does not establish an absence of hazards.</p>`}</section><section aria-label="Nearby Earth hazards"><h3>Nearby hazards</h3><p class="earth-watch-note">Current matching events, including older ongoing events. Distances use reported points or approximate alert-area centers, not exact hazard boundaries. ${nearby.unlocated} records without usable coordinates cannot be checked for proximity.</p>${nearby.matches.length ? joinSafeHtml(nearby.matches.slice(0, this.nearbyLimit).map(match => this.eventCard(match))) : safeHtml`<p>No matching nearby records in available coverage.</p>`}${nearby.matches.length > this.nearbyLimit ? safeHtml`<button type="button" data-earth-watch-action="more">Show more nearby events</button>` : ''}</section>` : safeHtml`<p class="earth-watch-empty">Save a place to see nearby hazards and a daily Earth brief.</p>`;
    const inbox = safeHtml`<section aria-label="Earth alert inbox"><h3>Alert inbox · ${unread} unread</h3><p class="earth-watch-note">${this.preferences.alertsEnabled ? 'In-app alerts are enabled.' : 'In-app alerts are paused.'} Alerts watch the selected saved location while this dashboard is open and visible. The first load and setting changes establish a baseline. Refreshing the same record does not repeat an alert. No background push notifications are sent.</p><div class="earth-watch-actions"><button type="button" data-earth-watch-action="read" ${this.watchState.inbox.length ? '' : safeHtml`disabled`}>Mark all read</button><button type="button" data-earth-watch-action="clear" ${this.watchState.inbox.length ? '' : safeHtml`disabled`}>Clear alert inbox</button></div>${this.watchState.inbox.length ? joinSafeHtml(this.watchState.inbox.slice(0, 30).map(change => safeHtml`<article class="earth-watch-change" data-earth-watch-change="${change.type}" data-unread="${!change.read}"><strong>${changeLabels[change.type]}</strong><h4>${change.event.title}</h4><p class="earth-watch-meta">${time(change.at)} · ${this.preferences.locations.find(place => place.id === change.locationId)?.name ?? 'Removed saved location'} · ${change.event.provider} · ${change.event.severity} severity</p><p class="earth-watch-note">${change.type === 'missing' ? 'The record is no longer listed in an available source. Its outcome is unknown; this is not a recovery report.' : change.type === 'closed' || change.type === 'recovered' || change.type === 'cancelled' ? 'This is a provider-reported status change; it does not establish that the area is safe.' : change.type === 'expired' ? 'The original alert validity period ended. Check the original authority for replacement alerts.' : 'A matching source record changed. Open the original report for current instructions.'}</p><a href="${safeUrlAttr(change.event.url)}" target="_blank" rel="noopener noreferrer">Original source ↗</a></article>`)) : safeHtml`<p class="earth-watch-note">No new matching changes since the baseline. Current matches appear above.</p>`}</section>`;
    this.setSafeContentImmediate(safeHtml`<div class="earth-watch-body">${locationControls}${this.message ? safeHtml`<p class="earth-watch-message" role="${this.messageError ? 'alert' : 'status'}">${this.message}</p>` : ''}${settings}<div class="earth-watch-actions"><button type="button" data-earth-watch-action="refresh" ${this.loading ? safeHtml`disabled` : ''}>${this.loading ? 'Refreshing…' : 'Refresh Earth watch'}</button><span class="earth-watch-meta">Latest feed fetch ${time(data.fetchedAt)}</span></div>${!this.loaded ? safeHtml`<p role="status">Loading shared Earth feeds…</p>` : ''}${summary}${inbox}<details class="earth-watch-sources"><summary>Source coverage and status</summary>${data.sources.length ? joinSafeHtml(data.sources.map(source => safeHtml`<p><strong>${source.provider}: ${sourceLabel(source)}</strong> · fetched ${time(source.fetchedAt)}<br>${source.coverage}${source.message ? safeHtml`<br>${source.message}` : ''}</p>`)) : safeHtml`<p>Sources are not available yet. Missing coverage does not establish safe conditions.</p>`}</details></div>`);
  }
  override destroy(): void {
    this.stopped = true; this.poll?.stop(); if (this.freshnessTimer) clearInterval(this.freshnessTimer); super.destroy();
  }
}
