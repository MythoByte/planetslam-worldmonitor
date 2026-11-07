import { safeStorageGetChecked, safeStorageSetChecked, isStorageAvailable } from '@/utils/safe-storage';
import { fetchCyberDataset } from './cyber-dashboard';
import { getCyberWatchlist, subscribeCyberWatchlist } from './cyber-watchlist';
import { evaluateCyberAlerts, freshCyberAlertStore, parseCyberAlertStore, normalizeCyberAlertRules, ALERT_RETENTION_MS, cyberAlertNotificationTag, type CyberAlertStore, type CyberAlertRules, type CyberAlertInputs, type CyberAlert } from './cyber-alert-engine';
import type { CyberDataset } from '@/types/cyber-dashboard';
const KEY = 'planetslam-cyber-alerts-v1', LOCK = 'planetslam-cyber-alerts';
const listeners = new Set<() => void>();
let owners = 0, timer: ReturnType<typeof setInterval> | null = null, unsubscribeWatch: (() => void) | null = null;
let checking = false, revision = 0, permissionRequest = false;
let error: string | null = null, storageFault = false, lastCoverage: string[] = [];
function read(): CyberAlertStore {
  const saved = safeStorageGetChecked(KEY);
  if (!saved.ok) { storageFault = true; error = 'Browser alert storage could not be read. Monitoring is paused; retry storage without resetting your history.'; return freshCyberAlertStore(); }
  const store = parseCyberAlertStore(saved.value);
  if (!store) { storageFault = true; error = 'Saved alert data is invalid. Reset local alert data to resume safely.'; return freshCyberAlertStore(); }
  store.events = store.events.filter(e => Date.now() - e.at < ALERT_RETENTION_MS);
  store.seen = store.seen.filter(([,at]) => Date.now() - at < ALERT_RETENTION_MS);
  return store;
}
function emit(): void { for (const callback of listeners) callback(); }
function persist(store: CyberAlertStore): boolean {
  const serialized = JSON.stringify(store);
  const written = isStorageAvailable() && safeStorageSetChecked(KEY, serialized);
  const verified = written ? safeStorageGetChecked(KEY) : { ok: false, value: null };
  if (!written || !verified.ok || verified.value !== serialized) {
    storageFault = true; error = 'Browser storage could not be saved or verified. Monitoring and browser delivery are paused; no notification was sent.'; emit(); return false;
  }
  storageFault = false; return true;
}
async function coordinated<T>(action: () => T | Promise<T>): Promise<T> {
  if (navigator.locks?.request) return navigator.locks.request(LOCK, action);
  return action();
}
export function getCyberAlertState() {
  const store = read(), supported = window.isSecureContext && typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function';
  return { store, error, storageFault, checking, coverage: [...lastCoverage], supported, coordinated: !!navigator.locks?.request,
    permission: supported ? Notification.permission : 'unsupported' as NotificationPermission | 'unsupported' };
}
export function subscribeCyberAlerts(callback: () => void): () => void { listeners.add(callback); return () => { listeners.delete(callback); }; }
export async function updateCyberAlertRules(patch: Partial<CyberAlertRules>): Promise<void> {
  revision++;
  await coordinated(() => {
    const s = read(); if (storageFault) return;
    const next = normalizeCyberAlertRules({ ...s.rules, ...patch });
    if (next.enabled !== s.rules.enabled) { s.signature = ''; s.nextDigestAt = null; s.digestSince = null; }
    if (next.digestHour !== s.rules.digestHour) s.nextDigestAt = null;
    s.rules = next; error = null; persist(s);
  });
  emit(); if (read().rules.enabled && !storageFault) void checkCyberAlerts();
}
export async function mutateCyberAlertInbox(action: 'read' | 'clear' | 'reset'): Promise<void> {
  revision++;
  await coordinated(() => {
    const s = action === 'reset' ? freshCyberAlertStore() : read();
    if (action !== 'reset' && storageFault) return;
    if (action === 'read') s.events = s.events.map(e => ({ ...e, read: true }));
    if (action === 'clear') s.events = [];
    error = null; persist(s);
  }); emit();
}
export async function enableCyberBrowserNotifications(): Promise<void> {
  const state = getCyberAlertState(), ticket = ++revision;
  if (!state.store.rules.enabled || !state.supported || !state.coordinated || storageFault || permissionRequest) return;
  permissionRequest = true;
  try {
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (ticket !== revision || !read().rules.enabled) return;
    if (permission !== 'granted') { error = 'Browser permission was not granted. Dashboard alerts remain available.'; emit(); return; }
    // Existing inbox entries are never replayed on permission grant. Only future checks can deliver.
    await updateCyberAlertRules({ browser: true });
  } catch { error = 'This browser could not request notification permission. Dashboard alerts remain available.'; emit(); }
  finally { permissionRequest = false; }
}
async function notify(event: CyberAlert): Promise<void> {
  const options: NotificationOptions = { body: event.kind === 'digest' ? 'Your Cyber alert digest is ready. Open the dashboard for details.' : 'A new Cyber alert is waiting. Open the dashboard for details.',
    tag: cyberAlertNotificationTag(event.id), icon: '/branding/planetslam/mark.svg', data: { url: '/dashboard?variant=cyber' } };
  const registration = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
  if (registration?.active && registration.showNotification) { await registration.showNotification('PlanetSlam Cyber', options); return; }
  const n = new Notification('PlanetSlam Cyber', options);
  n.onclick = () => { window.focus(); n.close(); };
}
export async function checkCyberAlerts(force = false): Promise<void> {
  if (checking || storageFault && !force) return;
  if (storageFault && force) {
    const savedRead = safeStorageGetChecked(KEY);
    if (!savedRead.ok) return;
    const saved = parseCyberAlertStore(savedRead.value);
    if (!saved || !persist(saved)) return;
    error = null; emit();
  }
  const initial = read(); if (!initial.rules.enabled || storageFault) return;
  checking = true; emit(); const ticket = revision;
  try {
    const names: CyberDataset[] = ['health', ...(initial.rules.vulnerabilities ? ['kev' as const, ...(initial.rules.epssMin ? ['epss' as const] : []), ...(initial.rules.cvssMin ? ['cvss' as const] : [])] : []), ...(initial.rules.incidents ? ['incidents' as const] : [])];
    const rows = await Promise.allSettled(names.map(n => fetchCyberDataset(n, force)));
    if (!owners || ticket !== revision) return;
    const inputs: CyberAlertInputs = {};
    rows.forEach((row,i) => { if (row.status === 'fulfilled') inputs[names[i] as keyof CyberAlertInputs] = row.value; });
    lastCoverage = rows.map((row,i) => `${names[i]}: ${row.status === 'fulfilled' ? row.value.status : 'unreachable'}`);
    await coordinated(async () => {
      if (!owners || ticket !== revision) return;
      const current = read(); if (!current.rules.enabled || storageFault) return;
      const { store, added } = evaluateCyberAlerts(current, inputs, getCyberWatchlist());
      error = rows.some(row => row.status === 'rejected') ? 'Some cached feeds could not be reached. Their baselines are retained; no missing record is treated as a new event.' : null;
      // Commit the observed events before any browser side effect. Failed/uncertain delivery is not retried automatically.
      if (!persist(store)) return;
      const deliver = store.rules.browser && typeof navigator.locks?.request === 'function' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
        ? added.filter(e => store.rules.delivery === 'daily' ? e.kind === 'digest' : e.kind !== 'digest').slice(0,3) : [];
      for (const event of deliver) {
        if (ticket !== revision || !read().rules.enabled || !read().rules.browser) break;
        try { await notify(event); } catch { error = 'Browser notification delivery could not be confirmed. Alerts remain in the inbox; this attempt will not be replayed.'; break; }
      }
    });
  } catch { error = 'Alert monitoring could not complete this check. Saved baselines were retained.'; }
  finally { checking = false; emit(); }
}
function onStorage(event: StorageEvent): void { if (event.key === KEY || event.key === null) { revision++; emit(); } }
function visible(): void { if (document.visibilityState === 'visible') void checkCyberAlerts(); }
export function startCyberAlerts(): () => void {
  owners++;
  if (!timer) {
    window.addEventListener('storage', onStorage); document.addEventListener('visibilitychange', visible);
    unsubscribeWatch = subscribeCyberWatchlist(() => { revision++; void checkCyberAlerts(); });
    timer = setInterval(() => { void checkCyberAlerts(); },60000); void checkCyberAlerts();
  }
  let released = false;
  return () => { if (released) return; released = true; if (--owners <= 0) { owners = 0; revision++; if (timer) clearInterval(timer); timer = null; unsubscribeWatch?.(); unsubscribeWatch = null;
    window.removeEventListener('storage',onStorage);document.removeEventListener('visibilitychange',visible); } };
}
