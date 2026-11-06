import type { Plugin } from 'vite';

function brandDashboard(html: string): string {
  return html
    .replace('<html', '<html data-brand="planetslam"')
    // Match the runtime URL selector before paint to avoid the wrong theme
    // flashing on LAN hosts. The existing nonce still authorizes this script.
    .replace('if(v)document.documentElement.dataset.variant=v;', "var q=new URLSearchParams(location.search).get('variant');v=['full','tech','finance','commodity','energy','happy'].includes(q)?q:'full';if(v)document.documentElement.dataset.variant=v;")
    .replace(/<title>.*?<\/title>/, '<title>PlanetSlam — Global Intelligence</title>')
    .replace(/<meta name="application-name" content=".*?" \/>/, '<meta name="application-name" content="PlanetSlam" />')
    .replace(/<link rel="canonical"[^>]*>/g, '')
    .replace('</head>', '<meta name="robots" content="noindex, nofollow" /><style>html[data-brand="planetslam"]{--wm-pro-banner-slot-height:0px}html[data-brand="planetslam"].wm-pro-banner-reserved #app::before{display:none}</style></head>')
    .replace('<span>World Monitor</span>', '<span>PlanetSlam</span>')
    .replace(/<link rel="icon"[^>]*>/g, '')
    .replace('</head>', '<link rel="icon" type="image/svg+xml" href="/branding/planetslam/mark.svg" /></head>');
}

/** Run after upstream variant HTML generation, which asserts its original SEO anchors. */
export function planetslamBrandPlugin(enabled: boolean): Plugin {
  return {
    name: 'planetslam-brand',
    enforce: 'post',
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
