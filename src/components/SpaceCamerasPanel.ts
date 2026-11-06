import { Panel } from './Panel';
import { WEBCAM_SOURCES } from '@/config/live-video-sources';
import { loadFromStorage, saveToStorage } from '@/utils';
import { safeHtml, joinSafeHtml, safeUrlAttr } from '@/utils/sanitize';
import { openLiveVideo, type LiveVideoSession } from '@/services/live-video/session';
import '@/styles/space.css';

const CAMERAS = [
  { id: 'iss', title: 'ISS · Earth from orbit', operator: 'NASA · official stream', location: 'International Space Station', entries: WEBCAM_SOURCES['nasa-live'], source: 'https://www.nasa.gov/live/' },
  { id: 'starbase', title: 'Starbase', operator: 'NASASpaceflight · independent camera operator', location: 'Boca Chica, Texas · 25.997°N, 97.157°W', entries: WEBCAM_SOURCES['space-x'].slice(0, 1), source: WEBCAM_SOURCES['space-x'][0] },
  { id: 'space-coast', title: 'Space Coast', operator: 'NASASpaceflight · independent camera operator', location: 'Florida · Kennedy Space Center / Cape Canaveral', entries: WEBCAM_SOURCES['space-x'].slice(1), source: WEBCAM_SOURCES['space-x'][1] },
] as const;
const FAVORITES_KEY = 'planetslam-space-camera-favorites-v1';
function loadFavorites(): Set<string> {
  const stored = loadFromStorage<unknown>(FAVORITES_KEY, []);
  return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && CAMERAS.some(cam => cam.id === id)) : []);
}

export class SpaceCamerasPanel extends Panel {
  private favorites = loadFavorites();
  private sessions = new Map<string, LiveVideoSession>();
  private pauseTimer: ReturnType<typeof setInterval>;
  private visible = true;
  private automaticallyPaused = false;
  private observer: IntersectionObserver | null = null;

  constructor() {
    super({ id: 'space-cameras', title: 'Space Live · Cameras', className: 'space-panel', defaultRowSpan: 3 });
    this.render();
    this.content.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-camera-play], [data-camera-stop], [data-camera-favorite]');
      if (target?.dataset.cameraPlay) this.play(target.dataset.cameraPlay);
      if (target?.dataset.cameraStop) this.stop(target.dataset.cameraStop);
      const id = target?.dataset.cameraFavorite;
      if (id) {
        this.favorites.has(id) ? this.favorites.delete(id) : this.favorites.add(id);
        saveToStorage(FAVORITES_KEY, [...this.favorites]);
        target.setAttribute('aria-pressed', String(this.favorites.has(id)));
        target.textContent = this.favorites.has(id) ? '★ Saved' : '☆ Save';
      }
    }, { signal: this.signal });
    this.pauseTimer = setInterval(() => {
      const paused = !this.visible || !this.canHostLiveMedia() || document.visibilityState === 'hidden';
      if (paused !== this.automaticallyPaused) {
        this.automaticallyPaused = paused;
        for (const session of this.sessions.values()) session.setPaused(paused);
      }
    }, 2000);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(([entry]) => { this.visible = !!entry?.isIntersecting; });
      this.observer.observe(this.element);
    }
  }

  private render(): void {
    const cameras = [...CAMERAS].sort((a, b) => Number(this.favorites.has(b.id)) - Number(this.favorites.has(a.id)));
    this.setSafeContentImmediate(safeHtml`<div class="space-body"><p class="space-note">Choose a camera to connect. Streams can be offline, scheduled, or blocked from embedding; live status is verified by the player. Offscreen streams pause automatically.</p><div class="space-camera-wall">${joinSafeHtml(cameras.map(cam => safeHtml`<article class="space-camera" data-camera="${cam.id}"><header><h3>${cam.title}</h3><button type="button" data-camera-favorite="${cam.id}" aria-label="Save ${cam.title}" aria-pressed="${this.favorites.has(cam.id)}">${this.favorites.has(cam.id) ? '★ Saved' : '☆ Save'}</button></header><div class="space-camera-player" data-camera-player="${cam.id}"><button class="space-camera-connect" type="button" data-camera-play="${cam.id}">▶ Connect camera</button></div><p class="space-camera-state" data-camera-state="${cam.id}" aria-live="polite">Ready to connect · availability unverified</p><p>${cam.operator}<small>${cam.location}</small></p><a href="${safeUrlAttr(cam.source)}" target="_blank" rel="noopener noreferrer">Open stream at source ↗</a> <button type="button" data-camera-stop="${cam.id}">Disconnect</button></article>`))}</div><p class="space-note">For mission coverage and launch webcasts: <a href="https://www.nasa.gov/live/" target="_blank" rel="noopener noreferrer">NASA Live ↗</a> · <a href="https://www.spacex.com/launches/" target="_blank" rel="noopener noreferrer">Official SpaceX missions ↗</a></p></div>`);
  }

  private play(id: string): void {
    const camera = CAMERAS.find(cam => cam.id === id);
    const player = this.content.querySelector<HTMLElement>(`[data-camera-player="${id}"]`);
    const status = this.content.querySelector<HTMLElement>(`[data-camera-state="${id}"]`);
    if (!camera || !player || !status || !this.canHostLiveMedia()) return;
    this.sessions.get(id)?.destroy();
    player.replaceChildren();
    const session = openLiveVideo(player, {
      source: { slot: `space/${id}`, entries: camera.entries, origin: 'builtin' },
      autoplay: true, muted: true,
      presentation: { title: camera.title, className: 'space-camera-iframe', controls: true },
      onState: state => {
        status.dataset.state = state.phase;
        status.textContent = state.phase === 'live' ? 'Live · verified by player'
          : state.phase === 'connecting' ? 'Connecting to provider…'
          : state.phase === 'recording' ? 'Recorded coverage · not live'
          : state.phase === 'unverified' ? 'Playback availability unverified · open at source if needed'
          : 'Stream offline or unavailable · open at source or reconnect';
        if (state.phase === 'offline') this.offerReconnect(id, player);
      },
    });
    this.sessions.set(id, session);
    // Do not repeatedly call play on visible sessions: that would undo a viewer's pause.
    if (this.automaticallyPaused) session.setPaused(true);
  }

  private offerReconnect(id: string, player: HTMLElement): void {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.cameraPlay = id;
    button.className = 'space-camera-connect'; button.textContent = 'Reconnect camera';
    player.append(button);
  }

  private stop(id: string): void {
    this.sessions.get(id)?.destroy(); this.sessions.delete(id);
    const player = this.content.querySelector<HTMLElement>(`[data-camera-player="${id}"]`);
    if (player) { player.replaceChildren(); this.offerReconnect(id, player); }
    const status = this.content.querySelector<HTMLElement>(`[data-camera-state="${id}"]`);
    if (status) { status.textContent = 'Disconnected'; status.dataset.state = 'disconnected'; }
  }

  override destroy(): void {
    clearInterval(this.pauseTimer); this.observer?.disconnect();
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear(); super.destroy();
  }
}
