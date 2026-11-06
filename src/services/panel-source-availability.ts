import { IS_PLANETSLAM } from '@/config/brand';
import type { PanelFreshnessSummary } from '@/services/data-freshness';

// Session-only evidence: never overwrite a user's saved panel selection.
const unavailableOwners = new Map<string, Set<object>>();
const listeners = new Set<() => void>();

export function isPanelSourceUnavailable(id: string): boolean {
  return IS_PLANETSLAM && (unavailableOwners.get(id)?.size ?? 0) > 0;
}

export function setPanelSourceUnavailable(id: string, owner: object, unavailable: boolean): void {
  if (!IS_PLANETSLAM) return;
  const before = isPanelSourceUnavailable(id);
  const owners = unavailableOwners.get(id) ?? new Set<object>();
  if (unavailable) owners.add(owner);
  else owners.delete(owner);
  if (owners.size) unavailableOwners.set(id, owners);
  else unavailableOwners.delete(id);
  if (before !== isPanelSourceUnavailable(id)) {
    for (const listener of listeners) listener();
  }
}

export function subscribePanelSourceAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasNoWorkingPanelSource(summary: PanelFreshnessSummary | null): boolean {
  // Unknown, stale-but-usable, and successful zero-event feeds stay visible.
  // A panel with a working fallback stays visible when another source fails.
  if (!summary?.sources.length) return false;
  return summary.sources.every(source =>
    source.status === 'error' || source.status === 'no_data' || source.status === 'disabled',
  );
}
