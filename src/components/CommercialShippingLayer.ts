import { fetchCommercialShipping } from '@/services/commercial-shipping';
import { findCommercialShippingArea, SHIPPING_AREAS, type CommercialShippingArea } from '@/services/commercial-shipping-areas';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import type { CommercialVessel } from '@/types/commercial-shipping';

/** One shared poller survives renderer switches; disabling cancels its work. */
export class CommercialShippingLayer {
  private loop?: SmartPollLoopHandle;
  private enabled = false;
  private generation = 0;
  private searchGeneration = 0;
  private area?: CommercialShippingArea;
  private readonly controls = document.createElement('details');
  private readonly status = document.createElement('span');
  private readonly input = document.createElement('input');
  private readonly message = document.createElement('span');
  private readonly reset = document.createElement('button');

  constructor(private container: HTMLElement, private paint: (vessels: CommercialVessel[]) => void,
    private center: (latitude: number, longitude: number, zoom: number) => void) {
    this.controls.className = 'commercial-shipping-status';
    this.controls.hidden = true;
    const summary = document.createElement('summary');
    this.status.setAttribute('role', 'status');
    summary.append(this.status);

    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = 'Search shipping area';
    this.input.type = 'search';
    this.input.placeholder = 'Country, port or waterway';
    this.input.maxLength = 100;
    this.input.required = true;
    const suggestions = document.createElement('datalist');
    suggestions.id = 'commercial-shipping-areas';
    this.input.setAttribute('list', suggestions.id);
    for (const { name } of SHIPPING_AREAS) suggestions.append(new Option(name, name));
    label.append(this.input);

    const search = document.createElement('button');
    search.type = 'submit';
    search.textContent = 'Search';
    this.reset.type = 'button';
    this.reset.textContent = 'Reset area';
    this.reset.hidden = true;
    this.message.setAttribute('role', 'status');
    form.append(label, suggestions, search, this.reset, this.message);
    form.addEventListener('submit', event => {
      event.preventDefault();
      void this.searchArea();
    });
    this.reset.addEventListener('click', () => {
      this.searchGeneration++;
      this.area = undefined;
      this.input.value = '';
      this.message.textContent = '';
      this.reset.hidden = true;
      this.input.focus();
      this.refresh();
    });
    this.controls.append(summary, form);
  }

  private async searchArea(): Promise<void> {
    const generation = ++this.searchGeneration;
    this.message.textContent = '';
    const area = await findCommercialShippingArea(this.input.value).catch(() => undefined);
    if (!this.enabled || generation !== this.searchGeneration) return;
    if (!area) {
      this.message.textContent = 'Area not found. Enter a country or choose a port or waterway.';
      return;
    }

    this.area = area;
    this.input.value = area.name;
    this.reset.hidden = false;
    const [south, west, north, east] = area.bounds;
    const span = Math.max(north - south, east - west);
    this.center((south + north) / 2, (west + east) / 2, span > 40 ? 2 : span > 14 ? 3 : span > 7 ? 4 : 5);
    this.refresh();
  }

  setEnabled(enabled: boolean): void {
    if (enabled && !this.controls.isConnected) this.container.prepend(this.controls);
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.controls.hidden = !enabled;
    this.searchGeneration++;
    this.refresh();
  }

  private refresh(): void {
    const generation = ++this.generation;
    this.loop?.stop();
    this.loop = undefined;
    this.paint([]);
    if (!this.enabled) return;
    const area = this.area;
    const heading = `Commercial Shipping · ${area?.name ?? 'Chokepoint focus'}`;
    this.status.textContent = `${heading} · Loading AIS positions…`;
    this.loop = startSmartPollLoop(async ({ signal }) => {
      try {
        const snapshot = await fetchCommercialShipping(signal, area?.bounds);
        if (!this.enabled || this.generation !== generation || signal?.aborted) return;
        const vessels = snapshot.available ? snapshot.vessels : [];
        this.paint(vessels);
        const positions = `${vessels.length} recent ${vessels.length === 1 ? 'position' : 'positions'}${snapshot.limited ? ' (sampled)' : ''}`;
        this.status.textContent = !snapshot.available ? `${heading} · AIS feed unavailable`
          : `${heading} · ${vessels.length ? positions : 'No recent classified vessels received'} · AISStream · Coverage incomplete`;
      } catch {
        if (!this.enabled || this.generation !== generation || signal?.aborted) return;
        this.paint([]);
        this.status.textContent = `${heading} · AIS feed unavailable`;
      }
    }, { intervalMs: 30_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true });
  }

  destroy(): void { this.setEnabled(false); this.controls.remove(); }
}
