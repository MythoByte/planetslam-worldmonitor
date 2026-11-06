import { Panel } from './Panel';
import { fetchSpaceDataset } from '@/services/space';
import { prepareSpaceOrbits, getPublishedSpaceOrbitSnapshot } from '@/services/space-orbits';
import { calculateMoonPhase, predictSpacePasses } from '@/services/space-observing';
import { getSpacePreferences, setSpaceObserver, setSpaceHorizon, toggleSpaceWatch, subscribeSpacePreferences, type SpacePreferences, type SpaceWatchKind } from '@/services/space-personalization';
import { getSpaceNotificationState, enableSpaceNotifications, disableSpaceNotifications, subscribeSpaceNotificationState, startSpaceNotifications, setSpacePassNotificationSnapshot, spaceObserverKey } from '@/services/space-notifications';
import { safeHtml, joinSafeHtml, type SafeHtml } from '@/utils/sanitize';
import type { OrbitCatalogData, SpaceEnvelope } from '@/types/space';
import type { PreparedSpaceOrbit } from '@/types/space-orbits';
import type { SpacePassPrediction, SpaceSatellitePass } from '@/types/space-observing';
import '@/styles/space.css';

function utc(value: number): string { return new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
function passCard(pass: SpaceSatellitePass): SafeHtml {
  return safeHtml`<article class="space-card" data-observing-pass="${pass.noradId}"><h3>${pass.name}</h3><div class="space-eyebrow">${pass.noradId === '25544' && pass.visible ? 'ISS visibility candidate' : pass.visible ? 'Visibility candidate' : 'Geometric pass · visual visibility not predicted'} · ${pass.elementStatus === 'stale' || pass.sourceStatus !== 'fresh' ? 'Stale orbital data' : 'Calculated prediction'}</div><p>${pass.ongoing ? 'Already above the horizon · ' : ''}${utc(pass.aosAt)} → ${utc(pass.losAt)}${pass.endsAfterWindow ? ' · end unresolved at prediction/data limit' : ''}</p><p>Rise ${pass.aosDirection} · Peak ${pass.maxElevationDeg.toFixed(0)}° ${pass.peakDirection} at ${utc(pass.peakAt)} · ${pass.endsAfterWindow ? 'Last bearing' : 'Set'} ${pass.losDirection}</p>${pass.visibleWindows.length ? safeHtml`<small>Potential viewing ${joinSafeHtml(pass.visibleWindows.map(window => safeHtml`${utc(window.startAt)}–${utc(window.endAt)}`), ' · ')}</small>` : ''}</article>`;
}

export class SpaceObservingPanel extends Panel {
  private preferences = getSpacePreferences();
  private latitudeDraft = this.preferences.observer?.latitude.toString() || '';
  private longitudeDraft = this.preferences.observer?.longitude.toString() || '';
  private selectedId = getPublishedSpaceOrbitSnapshot().selectedId || '25544';
  private latest: SpaceEnvelope<OrbitCatalogData> | null = null;
  private prepared: PreparedSpaceOrbit[] = [];
  private prediction: SpacePassPrediction | null = null;
  private predictionAbort: AbortController | null = null;
  private predicting = false;
  private loading = false;
  private note = '';
  private geolocationBusy = false;
  private geolocationRequest = 0;
  private lastPrediction = 0;
  private lastFetch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribePreferences: () => void;
  private unsubscribeNotifications: () => void;
  private stopNotifications: () => void = () => {};
  private disposed = false;

  constructor() {
    super({ id: 'space-observing', title: 'Tonight’s Sky & Observing', className: 'space-panel', defaultRowSpan: 3 });
    this.unsubscribePreferences = subscribeSpacePreferences(preferences => this.onPreferences(preferences));
    this.unsubscribeNotifications = subscribeSpaceNotificationState(() => { if (!this.signal.aborted) this.render(); });
    this.content.addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-observer-lat]')) this.latitudeDraft = input.value;
      if (input.matches('[data-observer-lon]')) this.longitudeDraft = input.value;
    }, { signal: this.signal });
    this.content.addEventListener('submit', event => {
      if (!(event.target as HTMLElement).matches('[data-observer-form]')) return;
      event.preventDefault();
      this.geolocationRequest++; this.geolocationBusy = false;
      if (!this.latitudeDraft.trim() || !this.longitudeDraft.trim()
        || !setSpaceObserver({ latitude: Number(this.latitudeDraft), longitude: Number(this.longitudeDraft), altitudeM: 0 })) {
        this.note = 'Enter a latitude from −90 to 90 and longitude from −180 to 180.'; this.render();
      } else { this.note = 'Observer location saved in this browser only.'; this.render(); }
    }, { signal: this.signal });
    this.content.addEventListener('change', event => {
      const input = event.target as HTMLSelectElement;
      if (input.matches('[data-observing-horizon]') && (input.value === '24' || input.value === '48')) setSpaceHorizon(Number(input.value) as 24 | 48);
    }, { signal: this.signal });
    this.content.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (!button) return;
      if (button.hasAttribute('data-observer-geolocate')) this.geolocate();
      if (button.hasAttribute('data-observer-clear')) {
        this.geolocationRequest++; this.geolocationBusy = false; this.note = 'Observer location cleared.'; setSpaceObserver(null);
      }
      if (button.hasAttribute('data-observing-retry')) void this.fetchData(true);
      if (button.hasAttribute('data-notifications-enable')) void enableSpaceNotifications().catch(() => { this.note = 'Browser notifications could not be enabled.'; this.render(); });
      if (button.hasAttribute('data-notifications-disable')) disableSpaceNotifications();
      if (button.dataset.spaceUnwatch && ['satellite', 'launch', 'mission'].includes(button.dataset.spaceWatchKind || '')) {
        toggleSpaceWatch(button.dataset.spaceWatchKind as SpaceWatchKind, button.dataset.spaceUnwatch);
      }
    }, { signal: this.signal });
    window.addEventListener('planetslam:space-orbits', () => {
      const id = getPublishedSpaceOrbitSnapshot().selectedId || '25544';
      if (id === this.selectedId) return;
      this.selectedId = id; this.clearPrediction(); void this.predict();
    }, { signal: this.signal });
    this.render();
    this.runWhenConnected(() => {
      this.stopNotifications = startSpaceNotifications();
      void this.fetchData();
      this.timer = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        if (Date.now() - this.lastFetch >= 15 * 60_000) void this.fetchData();
        else if (Date.now() - this.lastPrediction >= 5 * 60_000) void this.predict();
        this.render();
      }, 60_000);
    });
  }

  private onPreferences(preferences: SpacePreferences): void {
    if (this.signal.aborted) return;
    const observerChanged = JSON.stringify(preferences.observer) !== JSON.stringify(this.preferences.observer);
    const predictionChanged = observerChanged || preferences.horizonHours !== this.preferences.horizonHours
      || JSON.stringify(preferences.satelliteWatchlist) !== JSON.stringify(this.preferences.satelliteWatchlist);
    this.preferences = preferences;
    if (observerChanged) {
      this.latitudeDraft = preferences.observer?.latitude.toString() || '';
      this.longitudeDraft = preferences.observer?.longitude.toString() || '';
    }
    if (predictionChanged) { this.clearPrediction(); void this.predict(); }
    this.render();
  }

  private geolocate(): void {
    if (!navigator.geolocation) { this.note = 'This browser does not support location access. Enter coordinates manually.'; this.render(); return; }
    const request = ++this.geolocationRequest;
    this.geolocationBusy = true; this.note = 'Waiting for your browser’s location permission. Coordinates stay in this browser.'; this.render();
    navigator.geolocation.getCurrentPosition(position => {
      if (this.signal.aborted || request !== this.geolocationRequest) return;
      this.geolocationBusy = false;
      const valid = setSpaceObserver({ latitude: Number(position.coords.latitude.toFixed(4)), longitude: Number(position.coords.longitude.toFixed(4)), altitudeM: Number.isFinite(position.coords.altitude) ? Math.round(position.coords.altitude!) : 0 });
      this.note = valid ? 'Location saved locally to four decimal places. No coordinates were sent to PlanetSlam.' : 'The browser supplied an unusable location. Enter coordinates manually.'; this.render();
    }, () => {
      if (this.signal.aborted || request !== this.geolocationRequest) return;
      this.geolocationBusy = false; this.note = 'Location access was denied or unavailable. You can enter coordinates manually.'; this.render();
    }, { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 });
  }

  public async fetchData(force = false): Promise<void> {
    if (this.loading || this.signal.aborted) return;
    this.loading = true; this.lastFetch = Date.now();
    try {
      const latest = await fetchSpaceDataset<OrbitCatalogData>('orbits', force);
      const prepared = latest.status !== 'unavailable' && latest.data ? await prepareSpaceOrbits(latest.data) : [];
      if (this.signal.aborted) return;
      this.latest = latest; this.prepared = prepared;
    } catch {
      if (this.signal.aborted) return;
      this.latest = { dataset: 'orbits', status: 'unavailable', provider: 'CelesTrak', sourceUrl: '', fetchedAt: null, observedAt: null, expiresAt: null, data: null }; this.prepared = [];
    } finally { this.loading = false; }
    this.clearPrediction(); await this.predict(); this.render();
  }

  private clearPrediction(): void {
    this.predictionAbort?.abort(); this.predictionAbort = null; this.prediction = null; this.predicting = false;
    setSpacePassNotificationSnapshot(null);
  }

  private async predict(): Promise<void> {
    const observer = this.preferences.observer;
    if (!observer || !this.latest?.data || this.latest.status === 'unavailable' || this.signal.aborted) return;
    this.predictionAbort?.abort();
    const controller = new AbortController(); this.predictionAbort = controller;
    this.predicting = true; this.lastPrediction = Date.now(); this.render();
    try {
      const ids = [...new Set([this.selectedId, ...this.preferences.satelliteWatchlist, '25544'])];
      const prediction = await predictSpacePasses(this.prepared, { observer, ids, horizonHours: this.preferences.horizonHours, signal: controller.signal });
      if (this.signal.aborted || controller.signal.aborted) return;
      this.prediction = prediction;
      const expiresAt = prediction.windowEnd;
      setSpacePassNotificationSnapshot({ computedAt: prediction.generatedAt, expiresAt, observerKey: spaceObserverKey(observer),
        items: prediction.passes.map(pass => ({ id: `${pass.noradId}:${pass.aosAt}`, noradId: pass.noradId, name: pass.name, elementEpoch: pass.elementEpoch,
          riseAt: pass.visibleWindows.find(window => window.endAt > Date.now())?.startAt ?? pass.aosAt,
          visible: pass.visible, sourceStatus: pass.elementStatus === 'stale' ? 'stale' : pass.sourceStatus })),
      });
    } catch {
      if (!controller.signal.aborted && !this.signal.aborted) { this.prediction = null; this.note = 'Pass predictions are unavailable for the current orbital data. Retry after the next update.'; setSpacePassNotificationSnapshot(null); }
    } finally {
      if (this.predictionAbort === controller) { this.predicting = false; if (!this.signal.aborted) this.render(); }
    }
  }

  private watchlists(): SafeHtml {
    return safeHtml`<details data-space-watchlists><summary>My watchlists · ${this.preferences.satelliteWatchlist.length} satellites / ${this.preferences.launchWatchlist.length} launches / ${this.preferences.missionWatchlist.length} mission events</summary><p class="space-note">Up to 10 of each, stored in this browser. Save objects in Satellite Tracker, Launch Countdown, or Mission Events. Camera favorites remain in Space Live.</p>${joinSafeHtml((['satellite', 'launch', 'mission'] as const).map(kind => {
      const ids = this.preferences[`${kind}Watchlist`];
      return safeHtml`<h4>${kind === 'satellite' ? 'Satellites' : kind === 'launch' ? 'Launches' : 'Mission events'}</h4>${ids.length ? joinSafeHtml(ids.map(id => safeHtml`<p class="space-watch-item"><span>${kind === 'satellite' ? this.latest?.data?.items.find(item => item.noradId === id)?.name || `NORAD ${id}` : id}</span><button type="button" data-space-watch-kind="${kind}" data-space-unwatch="${id}" aria-label="Remove ${kind} ${id}">Remove</button></p>`)) : safeHtml`<p class="space-note">No saved ${kind === 'satellite' ? 'satellites' : kind === 'launch' ? 'launches' : 'events'}.</p>`}`;
    }))}</details>`;
  }

  private render(): void {
    const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const focusSelector = focused?.hasAttribute('data-observer-lat') ? '[data-observer-lat]' : focused?.hasAttribute('data-observer-lon') ? '[data-observer-lon]' : '';
    const watchlistsOpen = this.content.querySelector<HTMLDetailsElement>('[data-space-watchlists]')?.open || false;
    const moon = calculateMoonPhase(); const notification = getSpaceNotificationState();
    const now = Date.now();
    const prediction = this.prediction && this.prediction.generatedAt + 5 * 60_000 > now ? this.prediction : null;
    const passes = prediction?.passes.filter(pass => pass.losAt > now && pass.sourceExpiresAt > now) || [];
    const issVisible = passes.filter(pass => pass.noradId === '25544' && pass.visible).length;
    this.setSafeContentImmediate(safeHtml`<div class="space-body" data-observing-status="${!this.preferences.observer ? 'location-needed' : this.predicting ? 'calculating' : prediction ? 'ready' : 'unavailable'}"><section class="space-moon"><strong>${moon.phaseName}</strong><span>${Math.round(moon.illumination * 100)}% illuminated · ${moon.waxing ? 'waxing' : 'waning'}</span><small>Approximate lunar phase · ${moon.approximateAgeDays.toFixed(1)} days into the cycle</small></section><h3>Observer location</h3><p class="space-note">Enter coordinates manually, or explicitly ask your browser for your location. Stored only in this browser; coordinates are never included in PlanetSlam API requests. Calculations use UTC.</p><form data-observer-form class="space-observer-form"><label>Latitude<input data-observer-lat name="latitude" type="number" step="any" min="-90" max="90" required value="${this.latitudeDraft}" placeholder="−90 to 90" /></label><label>Longitude<input data-observer-lon name="longitude" type="number" step="any" min="-180" max="180" required value="${this.longitudeDraft}" placeholder="−180 to 180" /></label><button type="submit" data-observer-save>Save location</button></form><div class="space-observer-actions"><button type="button" data-observer-geolocate ${this.geolocationBusy ? safeHtml`disabled` : ''}>Use my location</button><button type="button" data-observer-clear>Clear location</button><button type="button" data-observing-retry>Refresh orbital data</button></div>${this.note ? safeHtml`<p class="space-note" role="status">${this.note}</p>` : ''}${this.preferences.observer ? safeHtml`<p class="space-note">Observer ${this.preferences.observer.latitude.toFixed(4)}°, ${this.preferences.observer.longitude.toFixed(4)}° · Altitude ${this.preferences.observer.altitudeM} m</p>` : ''}<label class="space-filter">Prediction window<select data-observing-horizon aria-label="Pass prediction window"><option value="24" ${this.preferences.horizonHours === 24 ? safeHtml`selected` : ''}>Next 24 hours</option><option value="48" ${this.preferences.horizonHours === 48 ? safeHtml`selected` : ''}>Next 48 hours</option></select></label><h3>Satellite passes</h3><p class="space-note">Geometric horizon crossings are shown for passes peaking at least 10° above the horizon. Visibility candidates require a dark observer sky and a sunlit satellite above 10°; clouds, brightness, terrain, and obstructions can still prevent viewing.</p>${!this.preferences.observer ? safeHtml`<p class="space-empty">Set an observer location to calculate passes.</p>` : this.predicting ? safeHtml`<p class="space-empty">Calculating passes locally…</p>` : !prediction ? safeHtml`<p class="space-empty">Current pass predictions unavailable. Check orbital data or refresh.</p>` : safeHtml`<p class="space-note">Calculated ${utc(prediction.generatedAt)} · ${prediction.processedCount} satellites processed${prediction.truncated ? ' · first 10 selected/watched objects only' : ''}. ISS visibility candidates: ${issVisible}.</p>${joinSafeHtml(prediction.satellites.map(item => safeHtml`<small class="space-pass-source">${item.name}: ${item.status}${item.elementStatus === 'stale' || item.sourceStatus === 'stale' ? ' · stale orbital data' : ''}${item.message ? ` · ${item.message}` : ''}</small>`))}${passes.length ? joinSafeHtml(passes.slice(0, 24).map(passCard)) : safeHtml`<p class="space-empty">No qualifying upcoming passes were returned for these objects in this window. Unavailable or expired objects are listed separately above.</p>`}${passes.length > 24 ? safeHtml`<small>Showing the next 24 passes.</small>` : ''}`}${this.watchlists()}<section class="space-notifications" data-notification-state="${notification.enabled ? 'enabled' : notification.permission}"><h3>Optional browser reminders</h3><p class="space-note">Off by default. Reminders work only while this dashboard page is open; they are not background or email alerts. Your browser may delay delivery. Save launches, mission events, or satellites to choose what to follow.</p><p>${!notification.supported ? 'Browser notifications are unsupported here.' : notification.enabled ? 'Browser reminders enabled for watched items.' : notification.permission === 'denied' ? 'Browser permission denied. Change site permissions in your browser to enable reminders.' : 'Browser reminders are off.'}</p>${notification.deliveryError ? safeHtml`<p class="space-note">${notification.deliveryError}</p>` : ''}${notification.enabled ? safeHtml`<button type="button" data-notifications-disable>Disable reminders</button>` : safeHtml`<button type="button" data-notifications-enable ${!notification.supported || notification.permission === 'denied' ? safeHtml`disabled` : ''}>Enable browser reminders</button>`}</section></div>`, () => {
      const horizon = this.content.querySelector<HTMLSelectElement>('[data-observing-horizon]'); if (horizon) horizon.value = String(this.preferences.horizonHours);
      const latitude = this.content.querySelector<HTMLInputElement>('[data-observer-lat]'); if (latitude) latitude.value = this.latitudeDraft;
      const longitude = this.content.querySelector<HTMLInputElement>('[data-observer-lon]'); if (longitude) longitude.value = this.longitudeDraft;
      const watchlists = this.content.querySelector<HTMLDetailsElement>('[data-space-watchlists]'); if (watchlists) watchlists.open = watchlistsOpen;
      if (focusSelector) this.content.querySelector<HTMLInputElement>(focusSelector)?.focus();
    });
  }

  override destroy(): void {
    if (this.disposed) return; this.disposed = true;
    this.geolocationRequest++; this.predictionAbort?.abort(); if (this.timer) clearInterval(this.timer);
    this.unsubscribePreferences(); this.unsubscribeNotifications(); this.stopNotifications(); setSpacePassNotificationSnapshot(null); super.destroy();
  }
}
