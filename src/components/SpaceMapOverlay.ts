import { fetchSpaceDataset } from '@/services/space';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import type { AuroraData, LaunchesData, SpaceEnvelope } from '@/types/space';
import { normalizeSpaceMapSnapshot, type SpaceMapSnapshot } from '@/types/space-map';
import { loadFromStorage, saveToStorage } from '@/utils';
import './space-map-overlay.css';

const PREFS_KEY = 'planetslam-space-map-overlays-v1';

/** A controller for native map layers. Data always comes from the shared cache. */
export class SpaceMapOverlay {
  private readonly controls = document.createElement('details');
  private readonly status = document.createElement('p');
  private readonly observer: MutationObserver;
  private readonly poll: SmartPollLoopHandle;
  private readonly auroraCheckbox = document.createElement('input');
  private readonly launchesCheckbox = document.createElement('input');
  private aurora: SpaceEnvelope<AuroraData> | null = null;
  private launches: SpaceEnvelope<LaunchesData> | null = null;
  private destroyed = false;

  constructor(private readonly container: HTMLElement, private readonly paint: (snapshot: SpaceMapSnapshot) => void) {
    this.controls.className = 'space-map-controls';
    this.controls.dataset.testid = 'space-map-controls';
    const summary = document.createElement('summary');
    summary.textContent = 'Space overlays';
    this.controls.append(summary);
    const prefs = loadFromStorage(PREFS_KEY, { aurora: true, launches: true });
    const addToggle = (input: HTMLInputElement, title: string, icon: string, checked: boolean) => {
      const label = document.createElement('label');
      input.type = 'checkbox';
      input.checked = checked;
      input.setAttribute('aria-label', title);
      const glyph = document.createElement('img');
      glyph.alt = '';
      glyph.width = 16;
      glyph.height = 16;
      glyph.className = 'space-layer-icon';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.src = `/branding/planetslam/space-icons/${icon}.svg`;
      label.append(input, ' ', glyph, ` ${title}`);
      this.controls.append(label);
      input.addEventListener('change', () => {
        saveToStorage(PREFS_KEY, { aurora: this.auroraCheckbox.checked, launches: this.launchesCheckbox.checked });
        this.refreshPaint();
      });
    };
    addToggle(this.auroraCheckbox, 'Aurora forecast', 'aurora', prefs.aurora === true);
    addToggle(this.launchesCheckbox, 'Upcoming launch sites', 'launch-sites', prefs.launches === true);
    this.status.setAttribute('aria-live', 'polite');
    this.status.textContent = 'Loading forecast and launch data…';
    this.controls.append(this.status);
    const note = document.createElement('small');
    note.textContent = 'Green: aurora model intensity. Amber: upcoming launch site. Forecast does not guarantee local visibility.';
    this.controls.append(note);
    // Map renderer switches replace their children. Reattach only this control;
    // the geographic layers are rehydrated by MapContainer through its data cache.
    this.observer = new MutationObserver(() => this.attach());
    this.observer.observe(container, { childList: true });
    this.attach();
    this.poll = startSmartPollLoop(async () => this.refresh(), {
      intervalMs: 5 * 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true,
    });
  }

  private attach(): void {
    if (!this.destroyed && this.controls.parentElement !== this.container) this.container.append(this.controls);
  }

  private async refresh(): Promise<void> {
    const [aurora, launches] = await Promise.allSettled([
      fetchSpaceDataset<AuroraData>('aurora'), fetchSpaceDataset<LaunchesData>('launches'),
    ]);
    if (this.destroyed) return;
    this.aurora = aurora.status === 'fulfilled' ? aurora.value : null;
    this.launches = launches.status === 'fulfilled' ? launches.value : null;
    const describe = (label: string, envelope: SpaceEnvelope<unknown> | null) => {
      const time = envelope?.observedAt ?? envelope?.fetchedAt;
      return `${label}: ${envelope?.status ?? 'unavailable'}${time ? ` · ${new Date(time).toUTCString()}` : ''}`;
    };
    this.status.textContent = `${describe('Aurora', this.aurora)}\n${describe('Launches', this.launches)}`;
    this.refreshPaint();
  }

  private refreshPaint(): void {
    const validAurora = this.aurora?.status !== 'unavailable' ? this.aurora?.data?.points : null;
    const validLaunches = this.launches?.status !== 'unavailable' ? this.launches?.data?.items : null;
    this.paint(normalizeSpaceMapSnapshot({
      aurora: this.auroraCheckbox.checked && Array.isArray(validAurora) ? validAurora : [],
      launches: this.launchesCheckbox.checked && Array.isArray(validLaunches)
        ? validLaunches.filter((launch): launch is typeof launch & { latitude: number; longitude: number; net: number } =>
          typeof launch.latitude === 'number' && typeof launch.longitude === 'number' && typeof launch.net === 'number') : [],
    }));
  }

  destroy(): void {
    this.destroyed = true;
    this.poll.stop();
    this.observer.disconnect();
    this.controls.remove();
    this.paint({ aurora: [], launches: [] });
  }
}
