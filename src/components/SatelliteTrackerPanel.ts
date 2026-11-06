import { Panel } from './Panel';
import { fetchSpaceDataset } from '@/services/space';
import { loadFromStorage, saveToStorage } from '@/utils';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';
import { prepareSpaceOrbits, calculateSpaceOrbitSnapshot, publishSpaceOrbitSnapshot, emptySpaceOrbitSnapshot, spaceOrbitGroupStatus } from '@/services/space-orbits';
import type { PreparedSpaceOrbit, SpaceOrbitSnapshot } from '@/types/space-orbits';
import type { OrbitCatalogData, OrbitGroupId, OrbitObject, SpaceEnvelope } from '@/types/space';
import '@/styles/space.css';

const PREFS_KEY = 'planetslam-space-satellites-v1';
const GROUPS: ReadonlyArray<readonly [OrbitGroupId, string]> = [
  ['stations', 'Stations'], ['weather', 'Weather'], ['science', 'Science'],
  ['communications', 'Communications / GEO'], ['starlink', 'Starlink'],
];
const HARD_ELEMENT_AGE = 7 * 86400_000;
const REFRESH_INTERVAL = 15 * 60_000;

export interface SatelliteTrackerPrefs { group: OrbitGroupId; selectedId: string }

/** Only known groups and plain NORAD identifiers may reach storage or selection. */
export function normalizeSatelliteTrackerPrefs(raw: unknown): SatelliteTrackerPrefs {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Partial<SatelliteTrackerPrefs> : {};
  return {
    group: GROUPS.some(([id]) => id === value.group) ? value.group! : 'stations',
    selectedId: typeof value.selectedId === 'string' && /^[1-9]\d{0,8}$/.test(value.selectedId) ? value.selectedId : '25544',
  };
}

function time(value: number | null | undefined): string {
  return value && Number.isFinite(value) ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Unavailable';
}
function number(value: number | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}
function age(epoch: number, now = Date.now()): string {
  if (!Number.isFinite(epoch) || epoch > now + 86400_000) return 'Unknown';
  if (epoch > now) return `${number((epoch - now) / 3600_000, 1)} hours ahead`;
  const hours = Math.max(0, (now - epoch) / 3600_000);
  return hours < 48 ? `${number(hours, 1)} hours` : `${number(hours / 24, 1)} days`;
}

export class SatelliteTrackerPanel extends Panel {
  private prefs = normalizeSatelliteTrackerPrefs(loadFromStorage<unknown>(PREFS_KEY, null));
  private query = '';
  private latest: SpaceEnvelope<OrbitCatalogData> | null = null;
  private prepared: PreparedSpaceOrbit[] = [];
  private snapshot: SpaceOrbitSnapshot = emptySpaceOrbitSnapshot();
  private fetching = false;
  private lastFetch = 0;
  private timer: ReturnType<typeof setInterval>;
  private visible = true;
  private observer: IntersectionObserver | null = null;

  constructor() {
    super({ id: 'space-satellites', title: 'Satellite Tracker', className: 'space-panel', defaultRowSpan: 3 });
    this.render();
    this.content.addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('[data-orbit-search]')) return;
      this.query = input.value.slice(0, 100);
      this.render();
    }, { signal: this.signal });
    this.content.addEventListener('change', event => {
      const input = event.target as HTMLSelectElement;
      if (!input.matches('[data-orbit-group]') || !GROUPS.some(([id]) => id === input.value)) return;
      this.prefs.group = input.value as OrbitGroupId;
      this.persist(); this.update();
    }, { signal: this.signal });
    this.content.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-orbit-id], [data-orbit-retry]');
      if (target?.hasAttribute('data-orbit-retry')) void this.fetchData(true);
      const id = target?.dataset.orbitId;
      if (!id || !this.latest?.data?.items.some(item => item.noradId === id)) return;
      this.prefs.selectedId = id; this.persist(); this.update();
    }, { signal: this.signal });
    this.timer = setInterval(() => {
      if (document.visibilityState === 'hidden' || !this.element.isConnected) return;
      if (Date.now() - this.lastFetch >= REFRESH_INTERVAL) void this.fetchData();
      // The map can remain visible while the tracker is offscreen or collapsed.
      // Only detailed DOM redraws depend on the tracker's own visibility.
      this.update(this.visible && !this.isCollapsed());
    }, 5000);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(([entry]) => {
        this.visible = !!entry?.isIntersecting;
        if (this.visible && this.element.isConnected) this.update();
      });
      this.observer.observe(this.element);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') this.update();
    }, { signal: this.signal });
    void this.fetchData();
  }

  private persist(): void { saveToStorage(PREFS_KEY, this.prefs); }

  public async fetchData(force = false): Promise<void> {
    if (this.fetching || this.signal.aborted) return;
    this.fetching = true; this.lastFetch = Date.now();
    try {
      const latest = await fetchSpaceDataset<OrbitCatalogData>('orbits', force);
      const prepared = latest.status !== 'unavailable' && latest.data ? await prepareSpaceOrbits(latest.data) : [];
      if (this.signal.aborted) return;
      this.latest = latest; this.prepared = prepared;
    } catch {
      if (this.signal.aborted) return;
      this.latest = { dataset: 'orbits', status: 'unavailable', provider: 'CelesTrak', sourceUrl: '', fetchedAt: null, observedAt: null, expiresAt: null, data: null, message: 'The cached orbital catalog could not be loaded. Retry to reconnect.' };
      this.prepared = [];
    } finally { this.fetching = false; }
    this.update();
  }

  private clearMap(): void {
    this.snapshot = emptySpaceOrbitSnapshot(); publishSpaceOrbitSnapshot(this.snapshot);
  }

  private usableCatalog(now = Date.now()): OrbitCatalogData | null {
    const latest = this.latest;
    if (!latest?.data || latest.status === 'unavailable' || (latest.expiresAt !== null && latest.expiresAt <= now)) return null;
    const groups = latest.data.groups.map(group => ({ ...group, status: spaceOrbitGroupStatus(group, now) }));
    const available = new Set(groups.filter(group => group.status !== 'unavailable').map(group => group.id));
    return { complete: latest.data.complete && groups.every(group => group.status === 'fresh'), groups,
      items: latest.data.items.map(item => ({ ...item, groups: item.groups.filter(id => available.has(id)) }))
        .filter(item => item.groups.length > 0 && now - item.epoch <= HARD_ELEMENT_AGE),
    };
  }

  private update(render = true): void {
    if (this.signal.aborted) return;
    const catalog = this.usableCatalog();
    if (!catalog || !catalog.groups.some(group => group.status !== 'unavailable')) this.clearMap();
    else {
      this.snapshot = calculateSpaceOrbitSnapshot(this.prepared, { selectedId: this.prefs.selectedId, group: this.prefs.group, includeGroup: true });
      publishSpaceOrbitSnapshot(this.snapshot);
    }
    if (render) this.render();
  }

  private selectedDetails(item: OrbitObject | undefined): SafeHtml {
    const selected = this.snapshot.selected;
    if (!selected) return safeHtml`<section data-orbit-selected><h3>${item?.name || 'Selected satellite'}</h3><p class="space-empty">${this.latest ? 'Calculated position unavailable. The selected object may be missing, its orbital elements may have expired, or propagation could not be completed.' : 'Loading the orbital catalog…'}</p><p>NORAD ${this.prefs.selectedId}${item ? safeHtml` · Element epoch ${time(item.epoch)} · Age ${age(item.epoch)}` : ''}</p></section>`;
    const source = this.usableCatalog()?.groups.find(group => group.status !== 'unavailable' && item?.groups.includes(group.id));
    return safeHtml`<section data-orbit-selected><div class="space-eyebrow">${selected.elementStatus === 'stale' ? 'Stale orbital elements · calculated estimate' : 'Calculated position · orbital estimate'}</div><h3>${selected.name}</h3><p>NORAD ${selected.noradId} · ${item?.objectId || 'International identifier unavailable'}</p><div class="space-orbit-metrics">${joinSafeHtml([
      ['Latitude', `${number(selected.latitude)}°`], ['Longitude', `${number(selected.longitude)}°`],
      ['Altitude', `${number(selected.altitudeKm, 1)} km`], ['Speed', `${number(selected.velocityKmS, 3)} km/s`],
      ['Period', `${number(selected.periodMinutes, 1)} min`], ['Inclination', `${number(selected.inclinationDeg)}°`],
    ].map(([label, value]) => safeHtml`<div><strong>${value}</strong><small>${label}</small></div>`))}</div><p class="space-note">Element epoch ${time(selected.epoch)} · Age ${age(selected.epoch)}<br />Calculated ${time(this.snapshot.calculatedAt)}</p>${source ? safeHtml`<a href="${safeUrlAttr(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">CelesTrak GP / OMM source ↗</a>` : ''}<p class="space-note">The map shows the selected object's ground track for 45 minutes before and after the calculated time. Positions are calculated from orbital elements, not live telemetry. Elements older than 48 hours are marked stale; elements older than seven days are not propagated.</p></section>`;
  }

  private render(): void {
    const focused = this.content.querySelector<HTMLInputElement>('[data-orbit-search]');
    const restoreFocus = focused === document.activeElement;
    const selection = focused?.selectionStart ?? this.query.length;
    const restoreGroupFocus = this.content.querySelector('[data-orbit-group]') === document.activeElement;
    const focusedResult = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.orbitId : undefined;
    const scrollTop = this.content.querySelector<HTMLElement>('[data-orbit-results]')?.scrollTop ?? 0;
    const latest = this.latest;
    const catalog = this.usableCatalog();
    const unavailable = !!latest && (!catalog || !catalog.groups.some(group => group.status !== 'unavailable'));
    const group = catalog?.groups.find(group => group.id === this.prefs.group);
    const status = unavailable ? 'unavailable' : !latest ? 'loading' : latest.status === 'stale' || !catalog?.complete ? 'stale' : 'fresh';
    // Search traverses the entire cached catalog; the group filter applies when the search is empty.
    const query = this.query.trim().toLowerCase();
    const items = (catalog?.items || []).filter(item => Date.now() - item.epoch <= HARD_ELEMENT_AGE)
      .filter(item => query ? `${item.name} ${item.noradId}`.toLowerCase().includes(query) : item.groups.includes(this.prefs.group));
    const selectedItem = latest?.data?.items.find(item => item.noradId === this.prefs.selectedId);
    this.setSafeContentImmediate(safeHtml`<div class="space-body space-orbit-tracker" data-orbit-status="${status}"><p class="space-note">Track a selected satellite and up to 120 markers from a curated group. Only the selected object receives a ground track; the catalog may contain more objects than the map displays.</p><div class="space-orbit-controls"><label>Group<select data-orbit-group aria-label="Satellite group">${joinSafeHtml(GROUPS.map(([id, label]) => safeHtml`<option value="${id}" ${this.prefs.group === id ? safeHtml`selected` : ''}>${label}</option>`))}</select></label><label>Search name or NORAD ID<input data-orbit-search aria-label="Search satellites by name or NORAD ID" type="search" maxlength="100" value="${this.query}" placeholder="ISS, NOAA, 25544…" /></label></div><div class="space-provenance">${latest?.sourceUrl ? safeHtml`<a href="${safeUrlAttr(latest.sourceUrl)}" target="_blank" rel="noopener noreferrer">${latest.provider}</a>` : safeHtml`<span>${latest?.provider || 'CelesTrak GP / OMM'}</span>`}<span>${status === 'unavailable' ? 'Unavailable' : status === 'stale' ? 'Stale · partial or delayed catalog' : latest ? 'Updated cached catalog' : 'Loading catalog'}</span><span>Fetched ${time(latest?.fetchedAt)}</span><button type="button" data-orbit-retry ${this.fetching ? safeHtml`disabled` : ''}>Refresh catalog</button></div>${latest?.message ? safeHtml`<p class="space-note">${latest.message}</p>` : ''}${group ? safeHtml`<p class="space-note">${group.label}: ${group.status}${group.truncated ? ' · limited catalog' : ''} · ${group.objectCount} of ${group.totalCount} objects${group.message ? ` · ${group.message}` : ''}</p>` : ''}${this.selectedDetails(selectedItem)}<p class="space-note">Map: ${this.snapshot.shownCount} of ${this.snapshot.totalCount} available objects shown.</p><h3>${query ? 'Search results · all groups' : GROUPS.find(([id]) => id === this.prefs.group)?.[1]} · ${items.length}</h3><div class="space-orbit-results" data-orbit-results>${items.length ? joinSafeHtml(items.slice(0, 100).map(item => safeHtml`<button type="button" class="space-orbit-result" data-orbit-id="${item.noradId}" aria-pressed="${item.noradId === this.prefs.selectedId}"><span>${item.name}<small>NORAD ${item.noradId}</small></span><small>${item.elementStatus === 'stale' ? 'Stale elements' : 'GP / OMM'}</small></button>`)) : safeHtml`<p class="space-empty">${unavailable ? 'Orbital catalog unavailable. No current positions are being shown.' : !latest ? 'Loading satellite catalog…' : group?.status === 'unavailable' && !query ? 'This group is unavailable; try another group or refresh later.' : 'No matching objects in this cached catalog.'}</p>`}</div>${items.length > 100 ? safeHtml`<p class="space-note">Showing the first 100 results. Search by name or NORAD ID to narrow the catalog.</p>` : ''}</div>`, () => {
      const list = this.content.querySelector<HTMLElement>('[data-orbit-results]'); if (list) list.scrollTop = scrollTop;
      // Keep the select's live value aligned when the base panel morphs its DOM.
      const groupSelect = this.content.querySelector<HTMLSelectElement>('[data-orbit-group]');
      if (groupSelect) groupSelect.value = this.prefs.group;
      if (restoreGroupFocus) groupSelect?.focus();
      if (focusedResult && /^[1-9]\d{0,8}$/.test(focusedResult)) this.content.querySelector<HTMLButtonElement>(`[data-orbit-id="${focusedResult}"]`)?.focus();
      if (restoreFocus) {
        const input = this.content.querySelector<HTMLInputElement>('[data-orbit-search]');
        input?.focus(); input?.setSelectionRange(selection, selection);
      }
    });
  }

  override destroy(): void {
    clearInterval(this.timer); this.observer?.disconnect(); this.clearMap(); super.destroy();
  }
}
