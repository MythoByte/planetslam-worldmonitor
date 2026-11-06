import { fetchSpaceDataset } from './space';
import { getSpacePreferences, subscribeSpacePreferences } from './space-personalization';
import { loadFromStorage, saveToStorage } from '@/utils';
import type { LaunchesData, MissionsData, OrbitCatalogData, SpaceMissionEvent } from '@/types/space';

const ENABLED_KEY = 'planetslam-space-notifications-enabled-v1';
const LEDGER_KEY = 'planetslam-space-notification-ledger-v1';
const REMINDER_MS = 5 * 60_000;
const RETENTION_MS = 7 * 86400_000;
const listeners = new Set<(state: SpaceNotificationState) => void>();
const schedules = new Map<string, { at: number; status: string }>();
let enabled = loadFromStorage<unknown>(ENABLED_KEY, false) === true;
let deliveryError: string | null = null;
let owners = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;
let checking = false;
let passes: SpacePassNoticeSnapshot | null = null;
let passGeneration = 0;
let lifecycleRevision = 0;

export interface SpaceNotificationState {
  enabled: boolean;
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  deliveryError: string | null;
}
export interface SpacePassNoticeSnapshot {
  computedAt: number;
  expiresAt: number;
  observerKey: string;
  items: { id: string; noradId: string; name: string; riseAt: number; elementEpoch?: number; visible: boolean; sourceStatus: 'fresh' | 'stale' | 'unavailable' }[];
}
interface Candidate { key: string; title: string; at: number; status: string; precise: boolean; label: string; passDedupePrefix?: string; upcomingUntil?: number; displayTime?: string }

/** Coordinate identity stays local; it is never sent with notification/provider requests. */
export function spaceObserverKey(observer: { latitude: number; longitude: number; altitudeM: number } | null): string {
  return observer && [observer.latitude, observer.longitude, observer.altitudeM].every(Number.isFinite)
    ? `${observer.latitude.toFixed(5)},${observer.longitude.toFixed(5)},${observer.altitudeM.toFixed(0)}` : '';
}
export function getSpaceNotificationState(): SpaceNotificationState {
  const supported = typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function';
  return { enabled, supported, permission: supported ? Notification.permission : 'unsupported', deliveryError };
}
function emit(): void { const state = getSpaceNotificationState(); for (const listener of listeners) listener(state); }
function onStorage(event: StorageEvent): void {
  if (event.key !== ENABLED_KEY && event.key !== null) return;
  enabled = loadFromStorage<unknown>(ENABLED_KEY, false) === true;
  if (!enabled) { lifecycleRevision++; passes = null; schedules.clear(); }
  emit();
}
export function subscribeSpaceNotificationState(listener: (state: SpaceNotificationState) => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
/** Invoke only from an explicit user action; mounting/refreshing never requests permission. */
export async function enableSpaceNotifications(): Promise<SpaceNotificationState> {
  const revision = ++lifecycleRevision;
  const state = getSpaceNotificationState();
  deliveryError = null;
  if (!state.supported) { enabled = false; emit(); return getSpaceNotificationState(); }
  try {
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (revision !== lifecycleRevision) return getSpaceNotificationState();
    enabled = permission === 'granted';
  } catch { enabled = false; deliveryError = 'Browser notification permission could not be requested.'; }
  saveToStorage(ENABLED_KEY, enabled); emit();
  if (enabled && owners > 0) void checkSpaceNotifications();
  return getSpaceNotificationState();
}
export function disableSpaceNotifications(): void {
  enabled = false; lifecycleRevision++; saveToStorage(ENABLED_KEY, false); passes = null; passGeneration++; schedules.clear(); emit();
}
export function setSpacePassNotificationSnapshot(snapshot: SpacePassNoticeSnapshot | null): void {
  passes = snapshot; passGeneration++;
}
function ledger(now: number): Record<string, number> {
  const raw = loadFromStorage<unknown>(LEDGER_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] <= now && now - entry[1] < RETENTION_MS).slice(-256));
}
function notify(key: string, title: string, body: string, now: number): boolean {
  const history = ledger(now);
  if (history[key] !== undefined) return false;
  try {
    // Keep raw observer coordinates out of native notification metadata.
    let tag = 2166136261;
    for (let i = 0; i < key.length; i++) tag = Math.imul(tag ^ key.charCodeAt(i), 16777619);
    const notification = new Notification(title.slice(0, 120), { body: body.slice(0, 400), tag: `planetslam-space-${(tag >>> 0).toString(16)}`, icon: '/branding/planetslam/mark.svg' });
    notification.onclick = () => { window.focus(); notification.close(); };
    history[key] = now; saveToStorage(LEDGER_KEY, Object.fromEntries(Object.entries(history).slice(-256)));
    return true;
  } catch {
    deliveryError = 'This browser could not show notifications. Reminders work only while this dashboard is open.';
    emit(); return false;
  }
}
function time(at: number): string { return new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
function validTime(at: unknown, now: number): at is number { return typeof at === 'number' && Number.isFinite(at) && at > now; }
function missionPeriod(item: SpaceMissionEvent): { until: number; label: string } {
  const date = new Date(item.date), y = date.getUTCFullYear(), m = date.getUTCMonth(), d = date.getUTCDate();
  switch (item.datePrecision) {
    case 'day': return { until: Date.UTC(y, m, d + 1), label: `${date.toISOString().slice(0, 10)} · day estimate` };
    case 'month': return { until: Date.UTC(y, m + 1, 1), label: `${date.toISOString().slice(0, 7)} · month estimate` };
    case 'quarter': return { until: Date.UTC(y, Math.floor(m / 3) * 3 + 3, 1), label: `${y} Q${Math.floor(m / 3) + 1} · quarter estimate` };
    case 'year': return { until: Date.UTC(y + 1, 0, 1), label: `${y} · year estimate` };
    default: return { until: item.date, label: time(item.date) };
  }
}
function candidateNotices(items: Candidate[], now: number, passItems = false): void {
  const current = new Set(items.map(item => item.key));
  const prefix = passItems ? 'pass:' : 'event:';
  for (const key of schedules.keys()) if (key.startsWith(prefix) && !current.has(key)) schedules.delete(key);
  let shown = 0;
  for (const item of items) {
    if (!Number.isFinite(item.at) || (item.upcomingUntil !== undefined ? item.upcomingUntil <= now : !validTime(item.at, now))) continue;
    const previous = schedules.get(item.key);
    schedules.set(item.key, { at: item.at, status: item.status });
    const revision = `${item.key}:${item.at}:${item.status}`;
    if (!passItems && previous && (previous.at !== item.at || previous.status !== item.status)) {
      if (shown < 3 && notify(`change:${revision}`, `${item.label} schedule updated`, `${item.title}\n${item.displayTime || time(item.at)} · ${item.status}\nProvider times may change.`, now)) {
        shown++;
        if (item.precise && item.at > now && item.at - now <= REMINDER_MS) {
          const history = ledger(now); history[`reminder:${revision}`] = now; saveToStorage(LEDGER_KEY, history);
        }
      }
    } else if (item.precise && item.at - now <= REMINDER_MS) {
      // Refining/recomputing the same pass can shift AOS by seconds. Coalesce
      // neighboring predictions rather than treating that jitter as a new pass.
      if (item.passDedupePrefix && Object.keys(ledger(now)).some(key => key.startsWith(item.passDedupePrefix!)
        && Math.abs(Number(key.slice(item.passDedupePrefix!.length)) - item.at) < 10 * 60_000)) continue;
      if (shown < 3 && notify(`reminder:${revision}`, `${item.label} in about ${Math.max(1, Math.ceil((item.at - now) / 60_000))} min`, `${item.title}\n${time(item.at)}\n${passItems ? 'Predicted visible opportunity; weather and local obstructions are not included.' : 'Provider estimate; schedules can change.'}`, now)) {
        shown++;
        if (item.passDedupePrefix) {
          const history = ledger(now); history[`${item.passDedupePrefix}${item.at}`] = now; saveToStorage(LEDGER_KEY, history);
        }
      }
    }
  }
}

/** Shared page-open loop. Each check re-reads watches and fresh cached source status. */
async function runSpaceNotificationCheck(now: number): Promise<void> {
  const state = getSpaceNotificationState();
  if (checking || !state.enabled || state.permission !== 'granted' || !Number.isFinite(now)) return;
  const revision = lifecycleRevision;
  checking = true;
  try {
    const prefs = getSpacePreferences();
    const eventCandidates: Candidate[] = [];
    const [launches, missions, orbits] = await Promise.allSettled([
      prefs.launchWatchlist.length ? fetchSpaceDataset<LaunchesData>('launches') : Promise.resolve(null),
      prefs.missionWatchlist.length ? fetchSpaceDataset<MissionsData>('missions') : Promise.resolve(null),
      passes && prefs.observer && prefs.satelliteWatchlist.length ? fetchSpaceDataset<OrbitCatalogData>('orbits') : Promise.resolve(null),
    ]);
    // Watches/permission may change while a cache read is in flight. Never deliver an old authorization.
    if (!enabled || revision !== lifecycleRevision || getSpaceNotificationState().permission !== 'granted') return;
    const current = getSpacePreferences();
    const launchData = launches.status === 'fulfilled' ? launches.value : null;
    if (launchData?.status === 'fresh' && launchData.data && launchData.expiresAt && launchData.expiresAt > now) {
      for (const item of launchData.data.items) if (current.launchWatchlist.includes(item.id) && validTime(item.net, now)
        && !/success|fail|cancel|in\s*flight|payload deployed/i.test(item.status)) eventCandidates.push({
        key: `event:launch:${item.id}`, title: item.name, at: item.net, status: item.status,
        precise: /^go\b/i.test(item.status), label: 'Watched launch',
      });
    }
    const missionData = missions.status === 'fulfilled' ? missions.value : null;
    if (missionData?.status === 'fresh' && missionData.data && missionData.expiresAt && missionData.expiresAt > now) {
      for (const item of missionData.data.items) if (current.missionWatchlist.includes(item.id) && Number.isFinite(item.date)
        && missionPeriod(item).until > now && !/completed|success|fail|cancel/i.test(item.status)) eventCandidates.push({
        key: `event:mission:${item.id}`, title: item.name, at: item.date, status: item.status,
        precise: item.datePrecision === 'second' || item.datePrecision === 'minute', label: 'Watched mission',
        upcomingUntil: missionPeriod(item).until, displayTime: missionPeriod(item).label,
      });
    }
    candidateNotices(eventCandidates, now);
    const source = passes;
    const orbitalData = orbits.status === 'fulfilled' ? orbits.value : null;
    const generation = passGeneration;
    if (source && source.computedAt <= now + 60_000 && now - source.computedAt <= 48 * 3600_000 && source.expiresAt > now
      && source.observerKey === spaceObserverKey(current.observer)) {
      const passCandidates = source.items.filter(item => current.satelliteWatchlist.includes(item.noradId)
        && item.visible && item.sourceStatus === 'fresh' && validTime(item.riseAt, now) && orbitalData?.status !== 'unavailable'
        && orbitalData?.data?.items.some(orbit => orbit.noradId === item.noradId && orbit.epoch === item.elementEpoch
          && now - orbit.epoch <= 48 * 3600_000 && orbit.epoch <= now + 86400_000
          && orbit.groups.some(id => orbitalData.data!.groups.some(group => group.id === id && group.status !== 'unavailable'
            && !group.refreshFailed && group.fetchedAt !== null && group.fetchedAt <= now + 60_000 && now - group.fetchedAt <= 12 * 3600_000)))).map(item => ({
        key: `pass:${source.observerKey}:${item.noradId}:${item.id}`, title: item.name, at: item.riseAt, status: 'predicted visible', precise: true, label: 'Watched satellite pass',
        passDedupePrefix: `pass-start:${source.observerKey}:${item.noradId}:`,
      }));
      if (generation === passGeneration) candidateNotices(passCandidates, now, true);
    }
  } catch { /* Missing/malformed source data suppresses reminders; panel status remains authoritative. */ }
  finally { checking = false; }
}
export async function checkSpaceNotifications(now = Date.now()): Promise<void> {
  // Cooperating tabs serialize ledger checks where Web Locks is available.
  // Native notification tags also coalesce identical deliveries in other browsers.
  try {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      await navigator.locks.request('planetslam-space-notifications', { ifAvailable: true }, async lock => {
        if (lock) await runSpaceNotificationCheck(now);
      });
    } else await runSpaceNotificationCheck(now);
  } catch { deliveryError = 'Browser notification coordination is temporarily unavailable.'; emit(); }
}
export function startSpaceNotifications(): () => void {
  owners++;
  if (!timer) {
    window.addEventListener('storage', onStorage);
    timer = setInterval(() => { void checkSpaceNotifications(); }, 60_000);
    unsubscribe = subscribeSpacePreferences(() => { passes = null; passGeneration++; });
    void checkSpaceNotifications();
  }
  let stopped = false;
  return () => {
    if (stopped) return; stopped = true; owners--;
    if (owners === 0) {
      lifecycleRevision++;
      if (timer) clearInterval(timer); timer = null; unsubscribe?.(); unsubscribe = null;
      window.removeEventListener('storage', onStorage);
      passes = null; passGeneration++; schedules.clear();
    }
  };
}
