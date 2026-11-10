import { IS_PLANETSLAM } from '@/config/brand';
import { PLANETSLAM_DASHBOARDS } from '@/config/planetslam-dashboards';
import { DEFAULT_MAP_LAYERS } from '@/config/panels';
import { buildPlanetSlamDashboard } from '@/services/planetslam-dashboards';
import { isPlanetSlamWorkspace, type PlanetSlamWorkspace } from '@/services/planetslam-dashboards';
import type { PanelConfig } from '@/types';
import { SITE_VARIANT } from '@/config/variant';
import { resetMissionPresetState } from '@/services/mission-presets';

/**
 * Dashboard tabs — named, persistent panel workspaces.
 *
 * Each tab stores a full snapshot of panel settings plus the panel order.
 * The ACTIVE tab's snapshot is only authoritative while the tab is inactive:
 * while a tab is active, the live global state (STORAGE_KEYS.panels +
 * PANEL_ORDER_KEY) is the source of truth, and the snapshot is refreshed
 * when the user switches away (see PanelLayoutManager.snapshotActiveTab).
 */
export interface PanelTab {
  id: string;
  name: string;
  panelSettings: Record<string, PanelConfig>;
  panelOrder: string[];
  bottomSet: string[];
  dashboard?: PlanetSlamWorkspace;
}

export interface TabsState {
  activeTabId: string;
  tabs: PanelTab[];
}

/** Matches the dashboard tab rename input (`maxLength` on the visible control). */
export const DASHBOARD_TAB_NAME_MAX_LENGTH = 40;

/**
 * Stable tab IDs from `generateTabId()`. Agents must use these, never display names.
 * `Date.now().toString(36)` and the random suffix are lowercase base36.
 */
export const DASHBOARD_TAB_ID_PATTERN = '^tab-[a-z0-9]+-[a-z0-9]+$';
export const DASHBOARD_TAB_ID_RE = new RegExp(DASHBOARD_TAB_ID_PATTERN);

// Per-variant key: each variant has its own default panel set, so tabs
// built on one variant must not leak into another.
const TABS_STORAGE_KEY = `worldmonitor-tabs-v1:${SITE_VARIANT}`;

export function generateTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isDashboardTabId(value: unknown): value is string {
  return typeof value === 'string' && DASHBOARD_TAB_ID_RE.test(value);
}

/**
 * Shape-check a decoded tabs payload the way `loadTabsState` does for the
 * stored one: drop malformed tabs, fall back to the first tab when the active
 * id is unknown, and return null when nothing usable remains. Shared with the
 * settings import so a backup is admitted under the same rules the app reads
 * storage with, rather than a second, drifting copy of them.
 */
export function normalizeTabsState(parsed: unknown): TabsState | null {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as TabsState).tabs)) return null;
  const candidate = parsed as TabsState;
  const tabs = candidate.tabs.filter((t): t is PanelTab =>
    !!t && typeof t.id === 'string' && typeof t.name === 'string'
    && !!t.panelSettings && typeof t.panelSettings === 'object'
    && Array.isArray(t.panelOrder) && Array.isArray(t.bottomSet));
  for (const tab of tabs) {
    if (tab.dashboard !== undefined && !isPlanetSlamWorkspace(tab.dashboard)) delete tab.dashboard;
  }
  if (tabs.length === 0) return null;
  const activeTabId = tabs.some((t) => t.id === candidate.activeTabId)
    ? candidate.activeTabId
    : tabs[0]!.id;
  return { activeTabId, tabs };
}

export function loadTabsState(): TabsState | null {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    let current: TabsState | null = null;
    try { current = raw ? normalizeTabsState(JSON.parse(raw)) : null; } catch { /* Keep other legacy workspaces recoverable. */ }
    if (!IS_PLANETSLAM || localStorage.getItem('planetslam-workspaces-migrated-v1')) return current;
    // Archive the old World payload before consolidating edition-specific tabs.
    if (raw && !localStorage.getItem('planetslam-workspaces-legacy-world-v1')) {
      try { localStorage.setItem('planetslam-workspaces-legacy-world-v1', raw); } catch { return current; }
    }
    const legacyVariant = localStorage.getItem('worldmonitor-panel-layout-variant');
    const tabs: PanelTab[] = (current?.tabs ?? []).map(tab => ({ ...tab, dashboard: tab.dashboard ?? {
      preset: 'full' as const, customized: true,
      layers: buildPlanetSlamDashboard('full', tab.panelSettings, DEFAULT_MAP_LAYERS).layers,
      view: 'global' as const, timeRange: '24h' as const, zoom: 1,
    } }));
    let activeTabId = current?.activeTabId;
    const ids = new Set(tabs.map(tab => tab.id));
    for (const preset of PLANETSLAM_DASHBOARDS) {
      if (preset.id === 'full') continue;
      const stored = localStorage.getItem(`worldmonitor-tabs-v1:${preset.id}`);
      let edition: TabsState | null = null;
      try { edition = stored ? normalizeTabsState(JSON.parse(stored)) : null; } catch { continue; }
      if (!edition) continue;
      for (const old of edition.tabs) {
        const id = ids.has(old.id) ? generateTabId() : old.id;
        ids.add(id);
        tabs.push({ ...old, id, name: `${preset.label}: ${old.name}`, dashboard: {
          preset: preset.id, customized: true,
          layers: buildPlanetSlamDashboard(preset.id, old.panelSettings, DEFAULT_MAP_LAYERS).layers,
          view: 'global', timeRange: '24h', zoom: 1,
        } });
        if (legacyVariant === preset.id && edition.activeTabId === old.id) activeTabId = id;
      }
    }
    if (!tabs.length) return current;
    const merged = { tabs, activeTabId: activeTabId ?? tabs[0]!.id };
    const active = tabs.find(tab => tab.id === merged.activeTabId);
    // The legacy app only persisted one live map selection across editions.
    // Keep it with the workspace that owned it before the upgrade.
    if (active?.dashboard && (!legacyVariant || active.dashboard.preset === legacyVariant)) {
      try {
        const stored = JSON.parse(localStorage.getItem('worldmonitor-layers') ?? '{}') as Record<string, unknown>;
        for (const key of Object.keys(active.dashboard.layers) as Array<keyof typeof active.dashboard.layers>) {
          if (typeof stored[key] === 'boolean') active.dashboard.layers[key] = stored[key] as boolean;
        }
      } catch { /* Use the preset map when legacy storage is malformed. */ }
    }
    if (saveTabsState(merged).persisted) localStorage.setItem('planetslam-workspaces-migrated-v1', '1');
    return merged;
  } catch {
    return null;
  }
}

export interface TabsPersistReceipt {
  persisted: boolean;
}

export function saveTabsState(state: TabsState): TabsPersistReceipt {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
    return { persisted: true };
  } catch {
    // Storage unavailable (private mode / quota) — tabs still work this session.
    return { persisted: false };
  }
}

/**
 * Panel selection for a fresh tab: the variant's default panels.
 * Reuses the mission-preset reset path so dynamic panels (custom widgets,
 * MCP panels, desktop runtime-config) survive with their current config.
 */
export function buildDefaultTabPanels(
  currentPanelSettings: Record<string, PanelConfig>,
): { panelSettings: Record<string, PanelConfig>; panelOrder: string[] } {
  const reset = resetMissionPresetState(currentPanelSettings);
  return { panelSettings: reset.panelSettings, panelOrder: reset.panelOrder };
}
