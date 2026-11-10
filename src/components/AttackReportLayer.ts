import { fetchAttackReports } from '@/services/attack-reports';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import { attackReportLabel, validAttackReports, type AttackReport, type AttackReportSnapshot } from '@/types/attack-reports';

export class AttackReportLayer {
  private element = document.createElement('section');
  private loop?: SmartPollLoopHandle;
  private enabled = false;
  private generation = 0;
  private selected = '';
  private snapshot: AttackReportSnapshot | null = null;
  private failed = false;

  constructor(private container: HTMLElement, private paint: (reports: AttackReport[]) => void) {
    this.element.className = 'gdelt-attack-status';
    this.element.setAttribute('aria-label', 'GDELT reported air attacks');
    this.element.hidden = true;
    window.addEventListener('planetslam:attack-report-select', this.select);
  }

  private select = (event: Event): void => {
    if (!this.enabled) return;
    const id = (event as CustomEvent<string>).detail;
    if (!this.snapshot?.reports.some(r => r.id === id)) return;
    this.selected = id;
    this.render(true);
  };

  setEnabled(enabled: boolean): void {
    if (enabled && !this.element.isConnected) this.container.append(this.element);
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    const generation = ++this.generation;
    this.loop?.stop(); this.loop = undefined;
    this.element.hidden = !enabled;
    this.paint([]);
    if (!enabled) { this.snapshot = null; this.selected = ''; return; }
    this.failed = false;
    this.render();
    this.loop = startSmartPollLoop(async ({ signal }) => {
      try {
        const snapshot = await fetchAttackReports(signal);
        if (!this.enabled || generation !== this.generation || signal?.aborted) return;
        this.snapshot = snapshot; this.failed = false;
      } catch {
        if (!this.enabled || generation !== this.generation || signal?.aborted) return;
        this.failed = true;
      }
      const reports = validAttackReports(this.snapshot?.reports || []);
      this.paint(reports);
      this.render();
    }, { intervalMs: 60_000, pauseWhenHidden: true, refreshOnVisible: true, runImmediately: true });
  }

  private render(open = this.element.querySelector('details')?.open === true): void {
    const reports = validAttackReports(this.snapshot?.reports || []);
    const details = document.createElement('details'); details.open = open;
    const summary = document.createElement('summary');
    const state = this.failed || this.snapshot?.status === 'unavailable' ? 'Feed unavailable'
      : this.snapshot?.status === 'stale' ? 'Feed stale'
      : !this.snapshot ? 'Loading…' : reports.length ? `${reports.length} reports${this.snapshot.limited ? ' (display limit)' : ''}` : 'No recent reports';
    summary.textContent = `Reported Air Attacks · ${state} · GDELT`;
    details.append(summary);
    const note = document.createElement('p');
    note.textContent = 'News reports of aerial weapons use, including missile and drone attacks. Not independently confirmed. Locations are approximate; a marker is not a verified impact site. Coverage is incomplete. Multiple reports can describe the same incident.';
    details.append(note);
    if (this.snapshot?.updatedAt) {
      const time = document.createElement('p');
      time.textContent = `Feed retrieved ${new Date(this.snapshot.updatedAt).toUTCString()} · Rolling 24-hour reporting window${this.failed || this.snapshot.status !== 'fresh' ? ' · Showing cached reports' : ''}`;
      details.append(time);
    }
    const credit = document.createElement('a'); credit.href = 'https://www.gdeltproject.org/'; credit.target = '_blank'; credit.rel = 'noopener noreferrer'; credit.textContent = 'Data: The GDELT Project'; details.append(credit);
    const ordered = [...reports].sort((a,b) => Number(b.id === this.selected) - Number(a.id === this.selected));
    for (const report of ordered.slice(0, 20)) {
      const row = document.createElement('div'); row.className = 'gdelt-attack-report'; row.dataset.reportId = report.id;
      if (report.id === this.selected) row.dataset.selected = 'true';
      const label = document.createElement('p'); label.textContent = attackReportLabel(report);
      const link = document.createElement('a'); link.href = report.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `Read source · ${report.publisher}`;
      row.append(label, link); details.append(row);
    }
    this.element.replaceChildren(details);
  }

  destroy(): void { this.setEnabled(false); window.removeEventListener('planetslam:attack-report-select', this.select); this.element.remove(); }
}
