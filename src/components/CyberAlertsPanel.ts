import { Panel } from './Panel';
import { safeHtml, safeUrlAttr, joinSafeHtml, type SafeHtml } from '@/utils/sanitize';
import { getCyberAlertState, subscribeCyberAlerts, startCyberAlerts, updateCyberAlertRules, mutateCyberAlertInbox, enableCyberBrowserNotifications, checkCyberAlerts } from '@/services/cyber-alerts';
import type { CyberAlertRules } from '@/services/cyber-alert-engine';
import '@/styles/cyber.css';
const time = (n: number | null) => n ? new Date(n).toISOString().slice(0,16).replace('T',' ') + ' UTC' : 'Not yet';
export class CyberAlertsPanel extends Panel {
  private unsubscribe: () => void;
  private rulesOpen = false;
  private statusOpen = false;
  private stop: (() => void) | null = null;
  constructor() {
    super({ id: 'cyber-alerts', title: 'Cyber Alerts & Digests', className: 'cyber-panel', defaultRowSpan: 3,
      infoTooltip: 'Opt-in monitoring of cached Cyber feeds while this panel is enabled and the Cyber dashboard is open. Rules, inbox and watchlist keywords remain in this browser.' });
    this.unsubscribe = subscribeCyberAlerts(() => this.render());
    this.content.addEventListener('change',event => {
      const el = event.target as HTMLInputElement, key = el.dataset.alertRule as keyof CyberAlertRules;
      if (!key) return;
      const value = el.type === 'checkbox' ? el.checked : ['epssMin','cvssMin','incidentDays','sourceChecks','digestHour'].includes(key) ? Number(el.value) : el.value;
      void updateCyberAlertRules({[key]:value});
    }, { signal: this.signal });
    this.content.addEventListener('click',event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-alert-action]')?.dataset.alertAction;
      if (action === 'enable') void updateCyberAlertRules({enabled:true});
      if (action === 'disable') void updateCyberAlertRules({enabled:false,browser:false});
      if (action === 'browser-on') void enableCyberBrowserNotifications();
      if (action === 'browser-off') void updateCyberAlertRules({browser:false});
      if (action === 'check') void checkCyberAlerts(true);
      if (action === 'read' || action === 'clear' || action === 'reset') void mutateCyberAlertInbox(action);
    }, { signal: this.signal });
    this.runWhenConnected(() => this.activateMonitoring());
  }
  private activateMonitoring(): void {
    if (!this.stop && !this.element.classList.contains('hidden')) this.stop = startCyberAlerts();
    this.render();
  }
  override show(): void { super.show(); this.runWhenConnected(() => this.activateMonitoring()); }
  override hide(): void { this.stop?.(); this.stop = null; super.hide(); }
  private render(): void {
    this.rulesOpen = this.content.querySelector<HTMLDetailsElement>('[data-alert-rules]')?.open ?? this.rulesOpen;
    this.statusOpen = this.content.querySelector<HTMLDetailsElement>('[data-alert-status]')?.open ?? this.statusOpen;
    const focusedRule = (document.activeElement as HTMLElement | null)?.dataset.alertRule;
    const state = getCyberAlertState(), s = state.store, r = s.rules;
    const select = (key: keyof CyberAlertRules, label: string, options: [string,string][]): SafeHtml => safeHtml`<label>${label}<select aria-label="${label}" data-alert-rule="${key}">${joinSafeHtml(options.map(([v,l]) => safeHtml`<option value="${v}" ${String(r[key]) === v ? safeHtml`selected` : ''}>${l}</option>`))}</select></label>`;
    const check = (key: keyof CyberAlertRules, label: string) => safeHtml`<label><input type="checkbox" data-alert-rule="${key}" ${r[key] ? safeHtml`checked` : ''}> ${label}</label>`;
    const unread = s.events.filter(e=>!e.read).length;
    this.setSafeContentImmediate(safeHtml`<div class="cyber-body"><div class="cyber-brief-heading"><strong>${state.storageFault ? 'Monitoring paused' : r.enabled ? 'Monitoring enabled' : 'Monitoring off'}</strong><span>${unread} unread alerts</span></div><p class="cyber-note">Opt in to cached-feed monitoring while this panel is enabled and the Cyber dashboard is open. First checks establish a baseline; existing records are not announced as new. Changing watchlist keywords or matching rules establishes new baselines. No email, background push or closed-browser delivery is configured.</p>${state.error ? safeHtml`<p class="cyber-note" role="status">${state.error}</p>` : ''}<div class="cyber-toolbar"><button data-alert-action="${r.enabled ? 'disable' : 'enable'}" ${state.storageFault ? safeHtml`disabled` : ''}>${r.enabled ? 'Disable monitoring' : 'Enable monitoring'}</button><button data-alert-action="check" ${!r.enabled || state.checking ? safeHtml`disabled` : ''}>${state.checking ? 'Checking cached feeds…' : 'Check cached feeds'}</button>${state.storageFault ? safeHtml`<button data-alert-action="check">Retry browser storage</button><button data-alert-action="reset">Reset local alert data</button>` : ''}</div><details class="cyber-methodology" data-alert-rules ${this.rulesOpen ? safeHtml`open` : ''}><summary>Alert rules and delivery</summary><div class="cyber-priority-filters">${check('vulnerabilities','Watchlist vulnerabilities')}${check('incidents','Incident research updates')}${check('sources','Source outages and recovery')}${select('epssMin','Minimum EPSS likelihood',[['0','Any / unknown allowed'],['10','10%'],['50','50%'],['90','90%']])}${select('cvssMin','Minimum technical severity',[['0','Any / unknown allowed'],['7','High or Critical'],['9','Critical']])}${select('incidentScope','Incident scope',[['all','All reported records'],['watchlist','Watchlist keyword matches']])}${select('incidentDays','Incident report age',[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days']])}${select('sourceChecks','Source transition confirmation',[['2','2 consecutive checks'],['3','3 consecutive checks'],['5','5 consecutive checks']])}${select('delivery','Browser delivery',[['realtime','New alerts (up to 3 per check)'],['daily','Daily digest only']])}${select('digestHour','Daily digest hour (UTC)',Array.from({length:24},(_,n)=>[String(n),`${String(n).padStart(2,'0')}:00 UTC`]))}</div><p class="cyber-note">Selected EPSS/CVSS thresholds both require known, fresh scores. Unknown values never count as zero. CVSS covers only the 40 newest KEV additions. Incident alerts describe monthly research records or meaningful source edits, not detected attacks. First source states are a baseline; changes require the chosen consecutive checks.</p><p class="cyber-note">Daily digests cover alerts observed since the previous digest, not activity while the dashboard was closed. Browser timers may be delayed. Inbox retains up to 200 alerts / 30 days; digests summarize that bounded retained history. Clear inbox preserves duplicate suppression.</p></details><section><h3>Optional browser notifications</h3><p class="cyber-note">${!state.supported ? 'Browser notifications are not supported in this context.' : !state.coordinated ? 'This browser cannot coordinate delivery across tabs. Dashboard alerts remain available.' : state.permission === 'denied' ? 'Browser permission is denied. Change site permissions to allow notifications.' : r.browser ? 'Browser notifications enabled. Notification text omits watchlist terms and source details.' : 'Browser notifications are off. Permission is requested only when you click Enable.'}</p><button data-alert-action="${r.browser ? 'browser-off' : 'browser-on'}" ${!r.browser && (!r.enabled || !state.supported || !state.coordinated || state.permission === 'denied' || state.storageFault) ? safeHtml`disabled` : ''}>${r.browser ? 'Disable browser notifications' : 'Enable browser notifications'}</button></section><details class="cyber-methodology" data-alert-status ${this.statusOpen ? safeHtml`open` : ''}><summary>Monitoring status and digest schedule</summary><p class="cyber-note">Last check ${time(s.lastCheckAt)} · next digest ${time(s.nextDigestAt)}. Checks normally run every minute while this dashboard stays open.</p><p class="cyber-note">${state.coverage.join(' · ') || 'No checks yet.'}</p>${joinSafeHtml((s.health || []).map(([name,status])=>safeHtml`<p class="cyber-note">${name}: ${status}</p>`))}</details><div class="cyber-toolbar"><button data-alert-action="read">Mark all read</button><button data-alert-action="clear">Clear inbox</button></div>${s.events.length ? joinSafeHtml(s.events.map(e=>safeHtml`<article class="cyber-card" data-alert-id="${e.id}" data-alert-kind="${e.kind}"><div class="cyber-eyebrow">${e.kind} · ${e.read ? 'Read' : 'Unread'}</div><a class="cyber-headline" href="${safeUrlAttr(e.url)}" target="_blank" rel="noopener noreferrer">${e.title} ↗</a><time>${time(e.at)}</time><p>${e.message}</p></article>`)) : safeHtml`<p class="cyber-empty">No alerts recorded in this browser. This is not proof that there were no threats or incidents.</p>`}</div>`);
    if (focusedRule) [...this.content.querySelectorAll<HTMLElement>('[data-alert-rule]')].find(el => el.dataset.alertRule === focusedRule)?.focus({ preventScroll: true });
  }
  destroy(): void { this.stop?.(); this.unsubscribe(); super.destroy(); }
}
