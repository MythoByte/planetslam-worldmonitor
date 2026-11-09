import type { Plugin } from 'vite';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { resolvePlanetSlamLink } from '../src/config/planetslam-links';

function htmlFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

export function localPagePaths(root: string): Set<string> {
  const paths = new Set(['/', '/dashboard', '/embed', '/settings.html']);
  for (const file of htmlFiles(root)) {
    const path = '/' + relative(root, file).split('\\').join('/');
    paths.add(path);
    if (path.endsWith('/index.html')) paths.add(path.slice(0, -11) || '/');
  }
  return paths;
}

export function rewritePlanetSlamHtmlLinks(html: string, validPaths: ReadonlySet<string>): string {
  const anchors = html.replace(/<a\b([^>]*?\bhref\s*=\s*)(["'])(.*?)\2([^>]*)>[\s\S]*?<\/a>/gi,
    (anchor: string, before: string, quote: string, href: string, after: string) => {
      const original = href.replace(/&amp;/g, '&');
      const target = resolvePlanetSlamLink(original, validPaths);
      if (target === null) return '';
      if (target === original) return anchor;
      const openingEnd = anchor.indexOf('>') + 1;
      return `<a${before}${quote}${target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}${quote}${after}>` + anchor.slice(openingEnd);
    });
  return anchors.replace(/<link\b[^>]*>/gi, tag => {
    if (!/\brel\s*=\s*["'](?:canonical|alternate)["']/i.test(tag)) return tag;
    const attribute = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!attribute) return tag;
    const target = resolvePlanetSlamLink(attribute[2]!.replace(/&amp;/g, '&'), validPaths);
    if (target === null) return '';
    return tag.replace(attribute[0], `href=${attribute[1]}${target.replace(/&/g, '&amp;')}${attribute[1]}`);
  });
}

function brandDashboard(html: string): string {
  return html
    .replace('<html', '<html data-brand="planetslam"')
    // Match the runtime URL selector before paint to avoid the wrong theme
    // flashing on LAN hosts. The existing nonce still authorizes this script.
    .replace('if(v)document.documentElement.dataset.variant=v;', "var q=new URLSearchParams(location.search).get('variant');v=q==='cyber'?'tech':['full','tech','finance','commodity','energy','happy','space','earth'].includes(q)?q:'full';if(v)document.documentElement.dataset.variant=v;")
    .replace(/<title>.*?<\/title>/, '<title>PlanetSlam — Global Intelligence</title>')
    .replace(/<meta name="application-name" content=".*?" \/>/, '<meta name="application-name" content="PlanetSlam" />')
    .replace(/<meta name="author" content=".*?" \/>/, '<meta name="author" content="MythoByte" />')
    .replace(/"author":\s*\{[^}]*"name":\s*"Elie Habib"\s*\}/g,
      '"author": {"@type": "Organization", "name": "MythoByte", "url": "https://github.com/MythoByte"}')
    .replace(/<link rel="canonical"[^>]*>/g, '')
    .replace('</head>', '<meta name="robots" content="noindex, nofollow" /><style>html[data-brand="planetslam"]{--wm-pro-banner-slot-height:0px}html[data-brand="planetslam"].wm-pro-banner-reserved #app::before{display:none}</style></head>')
    .replace('<span>World Monitor</span>', '<span>PlanetSlam</span>')
    .replace(/<link rel="icon"[^>]*>/g, '')
    .replace('</head>', '<link rel="icon" type="image/svg+xml" href="/branding/planetslam/mark.svg" /></head>');
}

/** Run after upstream variant HTML generation, which asserts its original SEO anchors. */
export function planetslamBrandPlugin(enabled: boolean): Plugin {
  let linkPolicyEntry: string | undefined;
  return {
    name: 'planetslam-brand',
    enforce: 'post',
    buildStart() {
      if (enabled) linkPolicyEntry = this.emitFile({ type: 'chunk', id: fileURLToPath(new URL('../src/planetslam-links-main.ts', import.meta.url)) });
    },
    config() {
      if (!enabled) return;
      const pages = localPagePaths(fileURLToPath(new URL('../public', import.meta.url)));
      return { define: { __PLANETSLAM_LOCAL_PAGES__: JSON.stringify([...pages]) } };
    },
    writeBundle: {
      order: 'pre',
      sequential: true,
      handler(options) {
        if (!enabled || !options.dir) return;
        const pages = localPagePaths(options.dir);
        for (const file of htmlFiles(options.dir)) {
          const before = readFileSync(file, 'utf8');
          let after = rewritePlanetSlamHtmlLinks(before, pages);
          if (linkPolicyEntry && /<a\b/i.test(before)) {
            const script = `<script type="module" src="/${this.getFileName(linkPolicyEntry)}"></script>`;
            after = after.replace('</body>', script + '</body>');
          }
          if (before === after) continue;
          writeFileSync(file, after);
          if (existsSync(file + '.gz')) writeFileSync(file + '.gz', gzipSync(after));
          if (existsSync(file + '.br')) writeFileSync(file + '.br', brotliCompressSync(after));
        }
      },
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        return enabled && !ctx.bundle && ctx.filename.endsWith('index.html') ? brandDashboard(html) : html;
      },
    },
    generateBundle(_options, bundle) {
      if (!enabled) return;
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'asset' && /^dashboard(?:-[a-z]+)?\.html$/.test(asset.fileName) && typeof asset.source === 'string') {
          asset.source = brandDashboard(asset.source);
        }
      }
    },
  };
}
