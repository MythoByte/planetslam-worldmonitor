import { fetchSpaceDataset } from '@/services/space';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import type { AuroraData, LaunchesData, SpaceEnvelope } from '@/types/space';
import { normalizeSpaceMapSnapshot, type SpaceMapSnapshot } from '@/types/space-map';

/** A controller for native map layers. Data always comes from the shared cache. */
export class SpaceMapOverlay {
  private readonly poll: SmartPollLoopHandle;
  private aurora: SpaceEnvelope<AuroraData> | null = null;
  private launches: SpaceEnvelope<LaunchesData> | null = null;
  private destroyed = false;

  constructor(private readonly paint: (snapshot: SpaceMapSnapshot) => void) {
    this.poll = startSmartPollLoop(async () => this.refresh(), {
      intervalMs: 5 * 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true,
    });
  }

  private async refresh(): Promise<void> {
    const [aurora, launches] = await Promise.allSettled([
      fetchSpaceDataset<AuroraData>('aurora'), fetchSpaceDataset<LaunchesData>('launches'),
    ]);
    if (this.destroyed) return;
    this.aurora = aurora.status === 'fulfilled' ? aurora.value : null;
    this.launches = launches.status === 'fulfilled' ? launches.value : null;
    this.refreshPaint();
  }

  private refreshPaint(): void {
    const validAurora = this.aurora?.status !== 'unavailable' ? this.aurora?.data?.points : null;
    const validLaunches = this.launches?.status !== 'unavailable' ? this.launches?.data?.items : null;
    this.paint(normalizeSpaceMapSnapshot({
      aurora: Array.isArray(validAurora) ? validAurora : [],
      launches: Array.isArray(validLaunches)
        ? validLaunches.filter((launch): launch is typeof launch & { latitude: number; longitude: number; net: number } =>
          typeof launch.latitude === 'number' && typeof launch.longitude === 'number' && typeof launch.net === 'number') : [],
    }));
  }

  destroy(): void {
    this.destroyed = true;
    this.poll.stop();
    this.paint({ aurora: [], launches: [] });
  }
}
