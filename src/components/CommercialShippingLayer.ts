import { fetchCommercialShipping } from '@/services/commercial-shipping';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import { freshCommercialVessels, type CommercialVessel } from '@/types/commercial-shipping';

/** One shared poller survives renderer switches; disabling cancels its work. */
export class CommercialShippingLayer {
  private loop?: SmartPollLoopHandle;
  private enabled = false;
  private generation = 0;
  private status = document.createElement('div');

  constructor(private container: HTMLElement, private paint: (vessels: CommercialVessel[]) => void) {
    this.status.className = 'commercial-shipping-status';
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
  }

  setEnabled(enabled: boolean): void {
    if (enabled && !this.status.isConnected) this.container.append(this.status);
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    const generation = ++this.generation;
    this.loop?.stop();
    this.loop = undefined;
    this.status.hidden = !enabled;
    this.paint([]);
    if (!enabled) return;
    this.status.textContent = 'Commercial Shipping · Loading AIS positions…';
    this.loop = startSmartPollLoop(async ({ signal }) => {
      try {
        const snapshot = await fetchCommercialShipping(signal);
        if (!this.enabled || this.generation !== generation || signal?.aborted) return;
        const vessels = snapshot.available ? freshCommercialVessels(snapshot.vessels) : [];
        this.paint(vessels);
        this.status.textContent = !snapshot.available ? 'Commercial Shipping · AIS feed unavailable'
          : `Commercial Shipping · ${vessels.length ? `${vessels.length} recent positions${snapshot.limited ? ' (display limit)' : ''}` : 'No recent classified vessels received'} · AISStream · Coverage incomplete`;
      } catch {
        if (!this.enabled || this.generation !== generation || signal?.aborted) return;
        this.paint([]);
        this.status.textContent = 'Commercial Shipping · AIS feed unavailable';
      }
    }, { intervalMs: 30_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true });
  }

  destroy(): void { this.setEnabled(false); this.status.remove(); }
}
