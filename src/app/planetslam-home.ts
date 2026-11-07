import { dataFreshness } from '@/services/data-freshness';
import { subscribePanelSourceAvailability } from '@/services/panel-source-availability';
import '../styles/planetslam-home.css';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from '@/utils/safe-storage';

const PREF = 'planetslam-home-collapsed-v1';
const RAIL = ['threat-timeline', 'cii', 'strategic-posture'];
const CARDS = ['intel', 'politics', 'middleeast', 'defense', 'shipping', 'military', 'cyber', 'markets', 'commodities', 'disaster-correlation', 'cascade', 'live-webcams', 'strategic-risk'];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function link(label: string, href: string, className = ''): HTMLAnchorElement {
  const node = element('a', className, label);
  node.href = href;
  if (href === '/dashboard') {
    node.dataset.psWorkspace = 'true';
    node.href = '/dashboard' + location.search;
  }
  return node;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const node = element('button', 'ps-control', label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

/** Presentation only: existing panel instances and map keep their data and event owners. */
export function mountPlanetSlamHome(): () => void {
  const app = document.getElementById('app')!;
  const main = document.getElementById('main')!;
  const grid = document.getElementById('panelsGrid')!;
  const map = document.getElementById('mapSection')!;
  map.classList.remove('collapsed');
  document.documentElement.dataset.psHome = 'true';
  document.title = 'PlanetSlam — Global Intelligence';

  let collapsed: string[] = [];
  try {
    const saved: unknown = JSON.parse(safeStorageGet(PREF) || '[]');
    if (Array.isArray(saved)) collapsed = saved.filter((key): key is string => typeof key === 'string');
  } catch { /* malformed preferences fall back to the default */ }

  const header = element('header', 'ps-header');
  const brand = link('', '/', 'ps-brand');
  const mark = element('img');
  mark.src = '/branding/planetslam/mark.svg';
  mark.alt = '';
  mark.width = 44;
  mark.height = 44;
  brand.append(mark, element('span', '', 'PlanetSlam'));
  const nav = element('nav', 'ps-nav');
  nav.id = 'ps-navigation';
  nav.setAttribute('aria-label', 'PlanetSlam');
  const homeLink = link('Home', '/', 'ps-nav-link');
  homeLink.setAttribute('aria-current', 'page');
  nav.append(homeLink);
  for (const [label, query] of [
    ['World', ''], ['Military', 'layers=military,bases,conflicts'],
    ['Aviation', 'layers=flights'], ['Maritime', 'layers=ais,waterways'],
    ['Cyber', 'variant=cyber'], ['Markets', 'variant=finance'], ['Intelligence', ''],
  ]) nav.append(link(label!, `/dashboard${query ? '?' + query : ''}`, 'ps-nav-link'));
  const connection = element('span', 'ps-connection');
  const openSearch = () => (document.getElementById('mobileSearchBtn') || document.getElementById('searchBtn'))?.click();
  const openSettings = () => (document.getElementById('unifiedSettingsBtn') || document.getElementById('mobileMenuSettings'))?.click();
  const search = button('⌕ Search', openSearch);
  const settings = button('Customize', openSettings);
  const menu = button('Menu', () => {
    const open = header.classList.toggle('ps-menu-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  menu.classList.add('ps-menu');
  menu.setAttribute('aria-controls', nav.id);
  menu.setAttribute('aria-expanded', 'false');
  const menuSettings = button('Customize', openSettings);
  menuSettings.classList.add('ps-nav-settings');
  nav.append(menuSettings);
  header.addEventListener('keydown', event => {
    if (event.key === 'Escape' && header.classList.contains('ps-menu-open')) {
      header.classList.remove('ps-menu-open');
      menu.setAttribute('aria-expanded', 'false');
      menu.focus();
    }
  });
  header.append(brand, nav, connection, search, settings, menu);
  app.prepend(header);

  const intro = element('section', 'ps-intro');
  intro.setAttribute('aria-labelledby', 'ps-home-title');
  const heading = element('div');
  heading.append(element('p', 'ps-eyebrow', 'YOUR WORLD, IN FOCUS'));
  const title = element('h1', '', 'Global situation');
  title.id = 'ps-home-title';
  heading.append(title, element('p', 'ps-tagline', 'Global Intelligence • Real-Time Events • Threat Watch'));
  const status = element('div', 'ps-situation');
  const clock = element('time', 'ps-clock');
  const health = element('span', 'ps-health');
  health.setAttribute('role', 'status');
  const freshness = element('span', 'ps-freshness');
  status.append(clock, health, freshness);
  const advanced = link('Open advanced workspace ↗', '/dashboard', 'ps-button-primary');
  intro.append(heading, status, advanced);
  header.after(intro);

  const utility = element('aside', 'ps-utility');
  utility.setAttribute('aria-label', 'Map layers and source health');
  const drawer = element('details', 'ps-layer-drawer');
  drawer.open = window.innerWidth >= 1440;
  drawer.append(element('summary', '', 'Map layers'));
  const searchLayers = element('input', 'ps-layer-search');
  searchLayers.type = 'search';
  searchLayers.placeholder = 'Find a map layer…';
  searchLayers.setAttribute('aria-label', 'Search map layers');
  const layerList = element('div', 'ps-layer-list');
  drawer.append(searchLayers, layerList);
  const sourceDetails = element('details', 'ps-sources');
  sourceDetails.append(element('summary', '', 'Source health & freshness'));
  const sources = element('div');
  sourceDetails.append(sources);
  const reset = button('Reset homepage layout', () => {
    collapsed = [];
    safeStorageRemove(PREF);
    for (const item of main.querySelectorAll<HTMLElement>('.ps-module')) applyCollapse(item);
    critical.open = true;
    drawer.open = window.innerWidth >= 1440;
  });
  utility.append(drawer, sourceDetails, reset,
    element('p', 'ps-note', 'Source coverage varies. AI assessments retain their original evidence and confidence.'));
  main.prepend(utility);

  const rail = element('aside', 'ps-intelligence');
  rail.setAttribute('aria-label', 'Intelligence overview');
  const railTitle = element('h2', 'ps-section-title', 'Intelligence watch');
  rail.append(railTitle);
  const critical = element('details', 'ps-alerts');
  critical.open = !collapsed.includes('critical-alerts');
  critical.append(element('summary', '', 'Critical alerts'), element('p', 'ps-note', 'An aggregate critical-alert count is not supplied. Review source-labelled events in Threat Timeline; missing data is not an all-clear.'));
  critical.addEventListener('toggle', () => {
    collapsed = collapsed.filter(key => key !== 'critical-alerts');
    if (!critical.open) collapsed.push('critical-alerts');
    safeStorageSet(PREF, JSON.stringify(collapsed));
  });
  map.after(rail);
  const cardTitle = element('div', 'ps-card-heading');
  cardTitle.append(element('h2', 'ps-section-title', 'Explore the intelligence'), link('All modules ↗', '/dashboard'));
  grid.before(cardTitle);
  const mounted = new WeakSet<HTMLElement>();
  const controls = new Map<HTMLElement, HTMLButtonElement>();
  const directory = new Map<string, HTMLElement>();
  for (const [key, title] of [['threat-timeline', 'Threat Timeline'], ['cii', 'Key Regions'], ['strategic-posture', 'AI Strategic Posture']]) {
    const card = element('section', 'ps-directory-card');
    card.style.order = String(RAIL.indexOf(key!) + 1);
    card.append(element('h3', '', title!), element('p', '', 'No current source data in this layout. Open the workspace for availability and configuration.'), link('Open dashboard ↗', '/dashboard'));
    directory.set(key!, card);
    rail.append(card);
  }
  for (const [key, title, description, target] of [
    ['intel', 'Latest Intelligence', 'Source-backed reporting and analysis.', '/dashboard'],
    ['politics', 'World News', 'Headlines with their original sources and timestamps.', '/dashboard'],
    ['middleeast', 'Regional News', 'Explore regional reporting and country briefs.', '/dashboard'],
    ['defense', 'Military & Defense', 'Force posture, conflicts and strategic sites.', '/dashboard?layers=military,bases,conflicts'],
    ['shipping', 'Maritime Activity', 'Vessel tracking, chokepoints and maritime infrastructure.', '/dashboard?layers=ais,waterways'],
    ['military', 'Aviation Monitoring', 'Explore existing military and commercial flight layers.', '/dashboard?layers=flights,military'],
    ['cyber', 'Cyber Intelligence', 'Open the dedicated cyber intelligence workspace.', '/dashboard?variant=cyber'],
    ['markets', 'Markets & Commodities', 'Market data and commodity monitoring.', '/dashboard?variant=finance'],
    ['disaster-correlation', 'Disaster Cascade', 'Explore hazards and connected events.', '/dashboard'],
    ['cascade', 'Infrastructure Impact', 'Explore dependencies and infrastructure exposure.', '/dashboard'],
    ['live-webcams', 'Live Webcams', 'Open existing camera collections.', '/dashboard'],
  ]) {
    const card = element('section', 'ps-directory-card');
    card.append(element('h3', '', title!), element('p', '', description!), link('Open dashboard ↗', target!));
    card.style.order = String(CARDS.indexOf(key!));
    directory.set(key!, card);
    grid.append(card);
  }

  function applyCollapse(panel: HTMLElement): void {
    const key = panel.dataset.panel!;
    const isCollapsed = collapsed.includes(key);
    panel.classList.toggle('ps-collapsed', isCollapsed);
    const control = controls.get(panel);
    if (control) {
      control.textContent = isCollapsed ? 'Expand' : 'Collapse';
      control.setAttribute('aria-expanded', String(!isCollapsed));
    }
  }

  function attachPanels(): void {
    for (const panel of main.querySelectorAll<HTMLElement>('.panel[data-panel]')) {
      const key = panel.dataset.panel!;
      if (RAIL.includes(key) && panel.parentElement !== rail) rail.insertBefore(panel, critical);
      if (CARDS.includes(key) && panel.parentElement !== grid) grid.append(panel);
      const entry = directory.get(key);
      if (entry) entry.hidden = !panel.classList.contains('hidden') && !panel.classList.contains('panel-source-unavailable');
      if (panel.dataset.deferredPanel === 'true') {
        if (RAIL.includes(key) || CARDS.includes(key)) {
          panel.classList.add('ps-module');
          panel.style.order = String(RAIL.includes(key) ? RAIL.indexOf(key) + 1 : CARDS.indexOf(key));
          applyCollapse(panel);
        } else panel.classList.add('ps-secondary-module');
        continue;
      }
      if (mounted.has(panel)) continue;
      mounted.add(panel);
      if (!RAIL.includes(key) && !CARDS.includes(key)) {
        panel.classList.add('ps-secondary-module');
        continue;
      }
      panel.classList.add('ps-module');
      panel.style.order = String(RAIL.includes(key) ? RAIL.indexOf(key) + 1 : CARDS.indexOf(key));
      const control = button('', () => {
        collapsed = collapsed.includes(key) ? collapsed.filter(item => item !== key) : [...collapsed, key];
        safeStorageSet(PREF, JSON.stringify(collapsed));
        applyCollapse(panel);
      });
      controls.set(panel, control);
      control.setAttribute('aria-label', `Toggle ${panel.querySelector('.panel-title')?.textContent || key}`);
      panel.querySelector('.panel-header')?.append(control);
      const full = link('Open dashboard ↗', '/dashboard', 'ps-module-link');
      panel.append(full);
      {
        const more = button('Show full module', () => {
          const expanded = panel.classList.toggle('ps-expanded');
          more.textContent = expanded ? 'Show summary' : 'Show full module';
          more.setAttribute('aria-expanded', String(expanded));
          // WindowedList normally listens to the dashboard's internal scroller.
          // Home scrolls the document, so refresh newly revealed chunks here.
          if (expanded) requestAnimationFrame(() => panel.querySelector('.windowed-list')?.dispatchEvent(new Event('scroll')));
        });
        more.setAttribute('aria-expanded', 'false');
        panel.append(more);
      }
      applyCollapse(panel);
    }
  }
  rail.append(critical);
  attachPanels();
  const observer = new MutationObserver(attachPanels);
  observer.observe(main, { childList: true, subtree: true });

  function updateHealth(): void {
    const all = dataFreshness.getAllSources();
    const enabled = all.filter(source => source.enabled && source.status !== 'disabled');
    const fresh = enabled.filter(source => source.status === 'fresh').length;
    const errors = enabled.filter(source => source.status === 'error').length;
    const stale = enabled.filter(source => ['stale', 'very_stale'].includes(source.status)).length;
    const missing = enabled.filter(source => source.status === 'no_data').length;
    health.textContent = !navigator.onLine ? 'Offline · cached data may be shown' : !enabled.length ? 'Feed coverage unavailable · no active sources' : `Feed coverage · ${fresh}/${enabled.length} fresh · ${stale} stale · ${errors} errors · ${missing} awaiting data`;
    health.dataset.state = !navigator.onLine || !enabled.length || errors || stale || missing ? 'degraded' : 'normal';
    const newest = dataFreshness.getSummary().newestUpdate;
    freshness.textContent = newest ? `Last source update ${newest.toISOString().replace('T', ' ').slice(0, 19)} UTC` : 'Awaiting source timestamps · global threat level unavailable';
    sources.replaceChildren(...all.map(source => {
      const row = element('p', 'ps-source-row');
      row.append(element('strong', '', source.name), element('span', '', `${source.status.replace(/_/g, ' ')} · ${source.lastUpdate ? source.lastUpdate.toISOString() : 'no timestamp'}`));
      return row;
    }));
  }

  // Proxy existing renderer controls: the original handler owns persistence and URL state.
  let layerSignature = '';
  function updateLayers(): void {
    const query = searchLayers.value.toLowerCase();
    const active = document.activeElement;
    if (active && layerList.contains(active)) return;
    const toggles = map.querySelectorAll<HTMLElement>('.layer-toggle[data-layer]');
    const signature = query + Array.from(toggles).map(toggle => `${toggle.dataset.layer}:${toggle.className}:${toggle.querySelector<HTMLInputElement>('input')?.checked}`).join('|');
    if (signature === layerSignature) return;
    layerSignature = signature;
    const groups = new Map<string, HTMLDetailsElement>();
    const previousGroups = new Map(Array.from(layerList.querySelectorAll('details')).map(group => [group.querySelector('summary')?.textContent, group.open]));
    for (const toggle of toggles) {
      const key = toggle.dataset.layer!;
      const name = toggle.textContent?.trim().replace(/\s+/g, ' ') || key;
      if (!`${name} ${key}`.toLowerCase().includes(query) || toggle.classList.contains('layer-toggle-locked')) continue;
      const category = /military|bases|conflict|nuclear|irradiat|hotspot|sanction/i.test(key) ? 'Security & conflict'
        : /cables|pipeline|storage|port|outage|datacenter|waterway/i.test(key) ? 'Infrastructure & transport'
        : /natural|weather|fire|radiat|space|quake/i.test(key) ? 'Earth & space' : 'Activity & intelligence';
      let group = groups.get(category);
      if (!group) {
        group = element('details', 'ps-layer-group');
        group.open = query ? true : (previousGroups.get(category) ?? category === 'Security & conflict');
        group.append(element('summary', '', category));
        groups.set(category, group);
      }
      const checkbox = toggle.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const enabled = checkbox ? checkbox.checked : toggle.classList.contains('active');
      const control = button(name, () => {
        (checkbox || toggle).click();
        control.setAttribute('aria-pressed', String(checkbox ? checkbox.checked : toggle.classList.contains('active')));
      });
      control.dataset.layer = key;
      control.title = toggle.title;
      control.disabled = checkbox?.disabled ?? false;
      control.setAttribute('aria-pressed', String(enabled));
      group.append(control);
    }
    layerList.replaceChildren(...groups.values());
    if (!groups.size) layerList.append(element('p', 'ps-note', toggles.length ? 'No matching layers.' : 'Map layers are loading…'));
  }
  searchLayers.addEventListener('input', updateLayers);
  function tick(): void {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    connection.textContent = navigator.onLine ? '● Connected' : '○ Offline';
    connection.title = 'Browser network connection; feed health is reported separately below.';
    updateLayers();
    attachPanels();
    for (const anchor of app.querySelectorAll<HTMLAnchorElement>('a[data-ps-workspace]')) anchor.href = '/dashboard' + location.search;
  }
  tick();
  updateHealth();
  const unsubscribe = dataFreshness.subscribe(updateHealth);
  const unsubscribeAvailability = subscribePanelSourceAvailability(attachPanels);
  const interval = window.setInterval(tick, 2000);
  const healthInterval = window.setInterval(updateHealth, 60_000);
  window.addEventListener('online', updateHealth);
  window.addEventListener('offline', updateHealth);
  window.dispatchEvent(new Event('resize'));
  return () => {
    observer.disconnect();
    unsubscribe();
    unsubscribeAvailability();
    clearInterval(interval);
    clearInterval(healthInterval);
    window.removeEventListener('online', updateHealth);
    window.removeEventListener('offline', updateHealth);
  };
}
