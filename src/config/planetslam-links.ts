/** Local counterparts verified against real pages, not the nginx SPA fallback. */
declare const __PLANETSLAM_LOCAL_PAGES__: string[] | undefined;

export const PLANETSLAM_NAVIGATION_PATHS = new Set(
  typeof __PLANETSLAM_LOCAL_PAGES__ !== 'undefined' ? __PLANETSLAM_LOCAL_PAGES__ : [
  '/', '/dashboard', '/embed', '/settings.html', '/blog', '/sources', '/accuracy',
]);
const EDITIONS: Record<string, string> = {
  tech: 'tech', finance: 'finance', commodity: 'commodity', energy: 'energy', happy: 'happy', space: 'space', cyber: 'cyber', earth: 'earth',
};
function pagePath(path: string): string {
  return path === '/' ? '/' : path.replace(/\/$/, '');
}

/** Preserve unrelated links; return null when no PlanetSlam counterpart exists. */
export function resolvePlanetSlamLink(
  href: string,
  validPaths: ReadonlySet<string> = PLANETSLAM_NAVIGATION_PATHS,
): string | null {
  if (/^mailto:[^?]*@(?:[\w.-]+\.)?worldmonitor\.app(?:\?|$)/i.test(href)) return null;
  if (/^\/(?:pro|mcp|oauth|desktop-sign-in)(?:[/?#]|$)/.test(href)) return null;
  if (/^\/(?:docs|status|settings)(?:[/?#]|$)/.test(href)
    && !validPaths.has(pagePath(href.split(/[?#]/)[0]!))) return null;
  let url: URL;
  try { url = new URL(href.startsWith('//') ? `https:${href}` : href); } catch { return href; }
  const host = url.hostname.toLowerCase();
  if (host !== 'worldmonitor.app' && !host.endsWith('.worldmonitor.app')) return href;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const edition = EDITIONS[host.replace(/\.worldmonitor\.app$/, '')];
  if (edition && (url.pathname === '/' || pagePath(url.pathname) === '/dashboard')) {
    url.pathname = '/dashboard';
    url.searchParams.set('variant', edition);
  } else if (host !== 'worldmonitor.app' && host !== 'www.worldmonitor.app') {
    return null;
  }
  // Hosted billing/auth/MCP products have no commissioned PlanetSlam service.
  if (/^\/(?:pro|mcp|oauth|desktop-sign-in)(?:\/|$)/.test(url.pathname)) return null;
  if (!validPaths.has(pagePath(url.pathname))) return null;
  url.protocol = 'https:';
  url.host = 'planetslam.com';
  url.port = '';
  url.username = '';
  url.password = '';
  return url.href;
}
