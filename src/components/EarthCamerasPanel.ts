import { Panel } from './Panel';
import { EARTH_CAMERAS, EARTH_CAMERA_KINDS, earthCameraDistanceKm, isEarthYouTubeCamera, type EarthCameraKind } from '@/config/earth-cameras';
import { loadFromStorage, saveToStorage } from '@/utils';
import { safeHtml, joinSafeHtml, safeUrlAttr } from '@/utils/sanitize';
import { openLiveVideo, type LiveVideoSession } from '@/services/live-video/session';
import { getEarthSelection } from '@/services/earth';
import type { EarthSelection } from '@/types/earth';
import './earth-cameras.css';

const FAVORITES_KEY = 'planetslam-earth-camera-favorites-v1';
export class EarthCamerasPanel extends Panel {
  private favorites: Set<string>;
  private sessions = new Map<string, LiveVideoSession>();
  private snapshots = new Map<string, number>();
  private cameraKind: EarthCameraKind | 'all' = 'all';
  private region = 'all';
  private media: 'all' | 'youtube' | 'snapshot' = 'all';
  private favoritesOnly = false;
  private selectedCameraId = '';
  private pendingCameraFocus = '';
  private focusFrame: number | null = null;
  private nearby: { latitude: number; longitude: number } | null = null;
  private visible = true;
  private automaticallyPaused = false;
  private readonly pauseTimer: ReturnType<typeof setInterval>;
  private observer: IntersectionObserver | null = null;

  constructor() {
    super({ id: 'earth-cameras', title: 'Earth Webcams', className: 'earth-cameras-panel', defaultRowSpan: 3 });
    const stored = loadFromStorage<unknown>(FAVORITES_KEY, []);
    this.favorites = new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && EARTH_CAMERAS.some(cam => cam.id === id)) : []);
    this.render();
    this.content.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      if (input.name === 'earth-camera-kind') this.cameraKind = input.value as EarthCameraKind | 'all';
      if (input.name === 'earth-camera-media') this.media = input.value as 'all' | 'youtube' | 'snapshot';
      if (input.name === 'earth-camera-region') this.region = input.value;
      if (input.name === 'earth-camera-favorites') this.favoritesOnly = input.checked;
      this.render();
    }, { signal: this.signal });
    this.content.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-earth-camera-play], [data-earth-camera-stop], [data-earth-camera-favorite], [data-earth-clear-nearby]');
      if (button?.dataset.earthCameraPlay) this.play(button.dataset.earthCameraPlay);
      if (button?.dataset.earthCameraStop) this.stop(button.dataset.earthCameraStop);
      if (button?.hasAttribute('data-earth-clear-nearby')) { this.nearby = null; this.render(); }
      const id = button?.dataset.earthCameraFavorite;
      if (id) {
        this.favorites.has(id) ? this.favorites.delete(id) : this.favorites.add(id);
        saveToStorage(FAVORITES_KEY, [...this.favorites]);
        button.setAttribute('aria-pressed', String(this.favorites.has(id)));
        button.textContent = this.favorites.has(id) ? '★ Saved' : '☆ Save';
        if (this.favoritesOnly) this.render();
      }
    }, { signal: this.signal });
    window.addEventListener('planetslam:earth-select', this.onSelection, { signal: this.signal });
    const selection = getEarthSelection();
    if (selection) this.applySelection(selection);
    this.pauseTimer = setInterval(() => this.tick(), 2000);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(([entry]) => { this.visible = !!entry?.isIntersecting; this.tick(); if (this.visible) this.focusSelectedCamera(); });
      this.observer.observe(this.element);
    }
  }

  private readonly onSelection = (event: Event): void => {
    const detail = (event as CustomEvent<EarthSelection>).detail;
    if (detail) this.applySelection(detail);
  };

  private applySelection(detail: EarthSelection): void {
    if (detail.kind === 'camera' && EARTH_CAMERAS.some(camera => camera.id === detail.id)) {
      this.selectedCameraId = detail.id; this.pendingCameraFocus = detail.id;
      this.cameraKind = 'all'; this.region = 'all'; this.media = 'all'; this.nearby = null; this.favoritesOnly = false; this.render();
      this.runWhenConnected(() => {
        // Deferred panels may enter a content-visibility skipped subtree. Reveal
        // the panel first; focus its card once the browser has laid it out.
        this.element.scrollIntoView({ block: 'nearest' });
        this.focusSelectedCamera();
      });
      return;
    }
    if (typeof detail.latitude !== 'number' || !Number.isFinite(detail.latitude) || Math.abs(detail.latitude) > 90
      || typeof detail.longitude !== 'number' || !Number.isFinite(detail.longitude) || Math.abs(detail.longitude) > 180) return;
    this.selectedCameraId = ''; this.pendingCameraFocus = '';
    this.nearby = { latitude: detail.latitude, longitude: detail.longitude };
    this.cameraKind = 'all'; this.region = 'all'; this.media = 'all'; this.favoritesOnly = false; this.render();
    if (detail.nearby) this.runWhenConnected(() => this.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  private focusSelectedCamera(): void {
    if (!this.pendingCameraFocus || this.focusFrame !== null || !this.element.isConnected) return;
    this.focusFrame = requestAnimationFrame(() => {
      this.focusFrame = null;
      if (this.signal.aborted || !this.pendingCameraFocus || !this.element.isConnected) return;
      const card = this.content.querySelector<HTMLElement>(`[data-earth-camera="${this.pendingCameraFocus}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'nearest' });
      card.focus({ preventScroll: true });
      if (document.activeElement === card) this.pendingCameraFocus = '';
    });
  }

  private render(): void {
    this.stopAll();
    let cameras = EARTH_CAMERAS.filter(camera => (this.cameraKind === 'all' || camera.kind === this.cameraKind)
      && (this.media === 'all' || this.media === 'youtube' && isEarthYouTubeCamera(camera) || this.media === 'snapshot' && !!camera.imageUrl)
      && (this.region === 'all' || camera.region === this.region) && (!this.favoritesOnly || this.favorites.has(camera.id))
      && (!this.nearby || earthCameraDistanceKm(this.nearby.latitude, this.nearby.longitude, camera) <= 250));
    cameras = [...cameras].sort((a, b) => this.nearby
      ? earthCameraDistanceKm(this.nearby.latitude, this.nearby.longitude, a) - earthCameraDistanceKm(this.nearby.latitude, this.nearby.longitude, b)
      : Number(this.favorites.has(b.id)) - Number(this.favorites.has(a.id)));
    const regions = [...new Set(EARTH_CAMERAS.map(camera => camera.region))];
    this.setSafeContentImmediate(safeHtml`<div class="earth-camera-body"><p class="earth-camera-note">Official cameras for natural events and local conditions. Connect on demand; media pauses when this panel is offscreen. Camera coverage is limited to the locations below.</p>
      <div class="earth-camera-filters"><label>Camera type <select name="earth-camera-kind" aria-label="Camera type"><option value="all">All types</option>${joinSafeHtml(EARTH_CAMERA_KINDS.map(kind => safeHtml`<option value="${kind}" ${this.cameraKind === kind ? 'selected' : ''}>${kind}</option>`))}</select></label>
      <label>Camera region <select name="earth-camera-region" aria-label="Camera region"><option value="all">All regions</option>${joinSafeHtml(regions.map(region => safeHtml`<option value="${region}" ${this.region === region ? 'selected' : ''}>${region}</option>`))}</select></label>
      <label>Camera media <select name="earth-camera-media" aria-label="Camera media"><option value="all" ${this.media === 'all' ? 'selected' : ''}>All media</option><option value="youtube" ${this.media === 'youtube' ? 'selected' : ''}>YouTube live sources</option><option value="snapshot" ${this.media === 'snapshot' ? 'selected' : ''}>Periodic snapshots</option></select></label>
      <label class="earth-camera-favorites"><input type="checkbox" name="earth-camera-favorites" ${this.favoritesOnly ? 'checked' : ''}> Saved only</label></div>
      ${this.nearby ? safeHtml`<p class="earth-camera-nearby">Cameras within 250 km of the selected location. Geographic context does not verify an event. <button type="button" data-earth-clear-nearby>Show all cameras</button></p>` : safeHtml``}
      <p class="earth-camera-count" aria-live="polite">${cameras.length} cameras${this.nearby ? ' nearby' : ' in this view'}</p>
      <div class="earth-camera-wall">${joinSafeHtml(cameras.map(camera => safeHtml`<article class="earth-camera-card" data-earth-camera="${camera.id}" data-earth-camera-selected="${this.selectedCameraId === camera.id}" tabindex="-1">
        <header><h3>${camera.title}</h3><button type="button" data-earth-camera-favorite="${camera.id}" aria-label="Save ${camera.title}" aria-pressed="${this.favorites.has(camera.id)}">${this.favorites.has(camera.id) ? '★ Saved' : '☆ Save'}</button></header>
        <p class="earth-camera-mode">${camera.imageUrl ? 'Periodic snapshot · not live video' : isEarthYouTubeCamera(camera) ? 'YouTube live source · connect to verify playback' : 'Live video source · playback unverified'} · ${camera.kind}</p>
        ${camera.note ? safeHtml`<p class="earth-camera-note">${camera.note}</p>` : safeHtml``}
        ${camera.sourceCheckedAt ? safeHtml`<p class="earth-camera-note">Source checked ${camera.sourceCheckedAt} · current playback checked on connection</p>` : safeHtml``}
        <div class="earth-camera-player" data-earth-camera-player="${camera.id}"><button type="button" data-earth-camera-play="${camera.id}">${camera.imageUrl ? 'Load snapshot' : 'Connect live camera'}</button></div>
        <p class="earth-camera-state" data-earth-camera-state="${camera.id}" aria-live="polite">Ready to connect · availability unverified</p>
        <p class="earth-camera-credit">${camera.operator}<small>${camera.region} · ${camera.latitude.toFixed(3)}°, ${camera.longitude.toFixed(3)}°${this.nearby ? ` · ${Math.round(earthCameraDistanceKm(this.nearby.latitude, this.nearby.longitude, camera))} km away` : ''}</small></p>
        <div class="earth-camera-links"><a href="${safeUrlAttr(camera.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open camera at source ↗</a>${camera.creditUrl ? safeHtml`<a href="${safeUrlAttr(camera.creditUrl)}" target="_blank" rel="noopener noreferrer">Image license</a>` : safeHtml``}<button type="button" data-earth-camera-stop="${camera.id}">Disconnect</button></div>
      </article>`))}</div>${cameras.length ? safeHtml`` : safeHtml`<p class="earth-camera-empty">No catalog cameras match this view. Try another filter or show all cameras.</p>`}
      <p class="earth-camera-note">A successful image load does not confirm its capture time. Check the timestamp printed in each snapshot; weather, darkness, delays, and seasonal shutdowns can obscure the view.</p></div>`);
  }

  private play(id: string): void {
    const camera = EARTH_CAMERAS.find(item => item.id === id);
    const player = this.content.querySelector<HTMLElement>(`[data-earth-camera-player="${id}"]`);
    const status = this.content.querySelector<HTMLElement>(`[data-earth-camera-state="${id}"]`);
    if (!camera || !player || !status || !this.canHostLiveMedia()) return;
    this.sessions.get(id)?.destroy(); this.sessions.delete(id); this.snapshots.delete(id); player.replaceChildren();
    if (camera.imageUrl) { this.loadSnapshot(id); return; }
    const session = openLiveVideo(player, {
      source: { slot: `earth/${id}`, entries: camera.entries ?? [], origin: 'builtin' }, autoplay: true, muted: true,
      presentation: { title: camera.title, className: 'earth-camera-video', controls: true },
      onState: state => {
        status.dataset.state = state.phase;
        status.textContent = state.phase === 'live' ? 'Live · verified by player'
          : state.phase === 'connecting' ? 'Connecting to provider…'
          : state.phase === 'recording' ? 'Recorded footage · not live'
          : state.phase === 'unverified' ? 'Playback unverified · open camera at source'
          : 'Offline or unavailable · open camera at source or reconnect';
        if (state.phase === 'offline') this.reconnect(id, player);
      },
    });
    this.sessions.set(id, session);
    if (this.automaticallyPaused) session.setPaused(true);
  }

  private loadSnapshot(id: string): void {
    const camera = EARTH_CAMERAS.find(item => item.id === id);
    const player = this.content.querySelector<HTMLElement>(`[data-earth-camera-player="${id}"]`);
    const status = this.content.querySelector<HTMLElement>(`[data-earth-camera-state="${id}"]`);
    if (!camera?.imageUrl || !player || !status) return;
    this.snapshots.set(id, Date.now());
    const image = document.createElement('img'); image.alt = `${camera.title} · periodic snapshot`; image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => {
      if (!this.snapshots.has(id) || !image.isConnected) return;
      status.dataset.state = 'snapshot'; status.textContent = `Snapshot loaded ${new Date().toUTCString()} · capture time unverified; check image timestamp`;
    }, { once: true });
    image.addEventListener('error', () => {
      if (!image.isConnected) return;
      this.snapshots.delete(id); status.dataset.state = 'offline'; status.textContent = 'Snapshot unavailable · open camera at source or reconnect';
      player.replaceChildren(); this.reconnect(id, player);
    }, { once: true });
    status.dataset.state = 'connecting'; status.textContent = 'Loading periodic snapshot…';
    player.replaceChildren(image);
    const url = new URL(camera.imageUrl); url.searchParams.set('earth-refresh', String(Math.floor(Date.now() / (camera.refreshMs ?? 300_000)))); image.src = url.href;
  }

  private tick(): void {
    const paused = !this.visible || !this.canHostLiveMedia() || document.visibilityState === 'hidden';
    if (paused !== this.automaticallyPaused) {
      this.automaticallyPaused = paused;
      for (const session of this.sessions.values()) session.setPaused(paused);
    }
    if (!paused) for (const [id, loadedAt] of this.snapshots) {
      const camera = EARTH_CAMERAS.find(item => item.id === id);
      if (Date.now() - loadedAt >= (camera?.refreshMs ?? 300_000)) this.loadSnapshot(id);
    }
  }

  private reconnect(id: string, player: HTMLElement): void {
    if (player.querySelector('[data-earth-camera-play]')) return;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.earthCameraPlay = id; button.textContent = 'Reconnect camera'; player.append(button);
  }

  private stop(id: string): void {
    this.sessions.get(id)?.destroy(); this.sessions.delete(id); this.snapshots.delete(id);
    const player = this.content.querySelector<HTMLElement>(`[data-earth-camera-player="${id}"]`);
    const status = this.content.querySelector<HTMLElement>(`[data-earth-camera-state="${id}"]`);
    if (player) { player.replaceChildren(); this.reconnect(id, player); }
    if (status) { status.dataset.state = 'disconnected'; status.textContent = 'Disconnected'; }
  }

  private stopAll(): void {
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear(); this.snapshots.clear();
  }

  override destroy(): void {
    clearInterval(this.pauseTimer); if (this.focusFrame !== null) cancelAnimationFrame(this.focusFrame);
    this.observer?.disconnect(); this.stopAll(); super.destroy();
  }
}
