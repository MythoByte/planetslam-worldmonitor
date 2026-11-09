import { isDesktopRuntime } from '@/config/desktop-runtime';
import { IS_PLANETSLAM } from '@/config/brand';

/**
 * Every variant a user can switch to. One desktop binary ships and switches
 * between these IDs in-app (#5908). Retired PlanetSlam Cyber links resolve
 * to Tech; the legacy ID remains valid for stored links and service contracts.
 * This list is also the set
 * `/api/download` accepts — `tests/desktop-one-binary-model.test.mjs` fails if
 * the two drift apart.
 */
export const SITE_VARIANTS = ['full', 'tech', 'finance', 'happy', 'commodity', 'energy', 'space', 'cyber', 'earth'] as const;

export type SiteVariant = (typeof SITE_VARIANTS)[number];

export function isSiteVariant(value: string | null | undefined): value is SiteVariant {
  return typeof value === 'string' && (SITE_VARIANTS as readonly string[]).includes(value);
}

const buildVariant = (() => {
  try {
    return import.meta.env.VITE_VARIANT || 'full';
  } catch {
    return 'full';
  }
})();

function loadStoredVariant(): string | null {
  try {
    return localStorage.getItem('worldmonitor-variant');
  } catch {
    return null;
  }
}

export const SITE_VARIANT: string = (() => {
  if (typeof window === 'undefined') return buildVariant;

  // Same detector the in-app variant switcher writes through
  // (src/app/event-handlers.ts, isDesktopRuntime). A raw bridge-globals check
  // here answered "web" during desktop:dev early boot and in
  // VITE_DESKTOP_RUNTIME=1 browser builds, so the switcher stored a variant
  // this read then ignored (#5912).
  if (isDesktopRuntime()) {
    const stored = loadStoredVariant();
    if (isSiteVariant(stored)) return IS_PLANETSLAM && stored === 'cyber' ? 'tech' : stored;
    return buildVariant;
  }

  // PlanetSlam editions share one origin. The URL is authoritative so copied
  // links and browser history work independently of a visitor's stored choice.
  if (IS_PLANETSLAM) {
    const selected = new URLSearchParams(window.location?.search).get('variant');
    if (selected === 'cyber') {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', 'tech');
      window.history.replaceState(window.history.state, '', url);
      return 'tech';
    }
    return isSiteVariant(selected) ? selected : 'full';
  }

  // window.location, not bare `location`: node-based tests stub `window`
  // without a global `location`, and this module must stay importable there.
  const h = window.location?.hostname;
  if (!h) return buildVariant;
  if (h.startsWith('tech.')) return 'tech';
  if (h.startsWith('finance.')) return 'finance';
  if (h.startsWith('happy.')) return 'happy';
  if (h.startsWith('commodity.')) return 'commodity';
  if (h.startsWith('energy.')) return 'energy';

  if (h === 'localhost' || h === '127.0.0.1') {
    const stored = loadStoredVariant();
    if (isSiteVariant(stored)) return IS_PLANETSLAM && stored === 'cyber' ? 'tech' : stored;
    return buildVariant;
  }

  return 'full';
})();
