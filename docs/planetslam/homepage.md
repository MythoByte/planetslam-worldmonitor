# PlanetSlam homepage

## Architecture inventory before implementation

Base: `22fb3a1bed27e78b537305f5341fd2090399280e` (2026-11-07).

- Vite/vanilla TypeScript; `src/main.ts` boots `App`, whose panel layout manager creates the map, settings, search and panel grid. Production emits `dashboard.html`; the existing nginx fallback serves it at `/` and `/dashboard`.
- `MapContainer` selects MapLibre/deck.gl, globe or the interactive SVG fallback. Layers, timeline, camera, dimensions and fullscreen belong to the existing map, not the homepage. Desktop WebGL maps already have searchable grouped layers; the homepage must also cover the SVG fallback.
- `src/config/panels.ts` and variant configs register news, regions, intelligence, strategic posture, threat timeline, markets, commodities, military, maritime, aviation, cyber, disasters, infrastructure, cameras, space and earth modules. Deferred panels register after boot.
- `src/services/` consumes existing generated Sebuf clients, bootstrap and provider APIs. Redis seeders, relay workers and edge handlers remain unchanged. `dataFreshness` provides per-source timestamps, errors and missing/stale/disabled states; browser connectivity alone is not feed health.
- Existing preferences include `worldmonitor-panels`, panel order, map mode/layers/camera/time range, source disables, theme, font and variant. Homepage preferences will use a separate namespace. `/dashboard` remains the Advanced Intelligence Workspace; all existing query deep links and variant navigation remain supported.
- Brand is build-time `VITE_BRAND=planetslam`. Existing tokens live in `src/styles/planetslam.css`; `branding/vite-plugin.ts` owns brand HTML and favicons. Upstream builds must retain their current entry and presentation.
- AGPL-3.0-only license and World Monitor source attribution remain in the footer.

## References

The older local `dev/repos/planetslam/moc.PNG` and `logo.PNG` were inspected. They show a wordmark and an older homepage, not the requested Worlds in Collision artwork. Captain explicitly deferred the artwork during implementation. This version uses the existing PlanetSlam mark with its natural aspect ratio and a 44px header height. Collision artwork and icon replacement are a later change.

## Implementation and validation

The full-variant PlanetSlam `/` route mounts `src/app/planetslam-home.ts` after the existing App initializes. `/dashboard` and other variants retain the advanced workspace. Unbranded builds do not import the homepage. The homepage moves existing panel elements, including deferred replacements, and retains their event handlers, provenance, timestamps, empty states and data owners. It does not replace the map or fetch from new APIs.

Homepage collapse preferences use `planetslam-home-collapsed-v1`. Reset only changes that namespace. The advanced workspace's saved panel order is protected while homepage panels appear in different regions. Generic workspace links retain the current map/deep-link query. Search and settings forward to existing controls, including the mobile command deck. Layer controls proxy the renderer's original handlers, keeping layer limits, persistence and URL updates intact. The original layer control remains available in fullscreen.

The CSS lives in a separate, lazy stylesheet, scoped to `data-ps-home`. Overrides of upstream `!important` panel spans and map heights live in the existing `base` cascade layer; this is necessary because important declarations inside a layer outrank unlayered declarations. Desktop uses 240px/650px minimum/300px rails; smaller screens use a layer drawer and two- or one-column cards. The document scrolls naturally. Original detailed map modes and workspace resize controls remain available in the advanced workspace.

Health uses the existing per-source freshness tracker. It separates browser connectivity from feed freshness, reports stale/error/missing coverage and shows source timestamps. Disabled sources are identified in source details and excluded from the monitored denominator. No homepage threat score or aggregate critical-only alert count is invented. Available timeline values remain the upstream panel's explicitly labelled critical/high aggregate. When an enabled source is unavailable, a module entry remains discoverable through a workspace link rather than silently disappearing.

News summaries show the first three items with their original source and timestamp; Show full module reveals the remaining items. Rail charts and detailed groups use the same progressive disclosure. Disabled, unavailable or dedicated-edition modules remain accessible through the module directory and workspace links.

### Evidence and checks

Screenshots under `homepage-evidence/` use **controlled synthetic API responses**, including synthetic headlines under a registered source name so the real source-selection filter is exercised. They are UI evidence, not claims about live provider availability. `before-*` captures show the advanced dashboard; `overview-*` shows the homepage/map and `home-*` shows the intelligence cards after scrolling. Viewport screenshots are used because upstream content visibility deliberately defers offscreen rendering.

- Node 24 preflight repair/test readiness passed.
- TypeScript, architectural boundaries and full lint passed (lint reports existing warnings/informational diagnostics).
- Full `VITE_BRAND=planetslam npm run build` passed, including blog, Pro, crawlable corpus, sitemap, TypeScript, Vite and PWA generation. Incidental regenerated dates/sitemaps were restored to keep this change focused.
- Existing freshness health suite: 21 passed. Existing PlanetSlam link, source-selection, availability and variant DOM suites: 21 passed.
- Branded browser verification: six passed, covering the advanced dashboard at 1440/768/390px and homepage at 1440/1024/390px. Homepage checks exercise real SVG map mounting, searchable layer toggles and stored state, synthetic news provenance, collapse/reload/reset, preservation of workspace order, fullscreen/Escape, search, menu, settings and offline status. The new header, summary, layer controls and alerts pass the scoped axe WCAG A/AA scan.
- Unbranded dashboard regression checks passed at 1440/768/390px. The first desktop attempt hit Chromium `ERR_NETWORK_CHANGED` while importing App modules; the trace identified the transport failure, and the targeted rerun passed.

### Limits and maintenance debt

- Headless verification uses the interactive SVG fallback. A real GPU/WebGL 2D/3D session and live provider freshness were not commissioned by these fixture tests. Existing map and provider implementations are retained.
- This first homepage reuses the App's startup and background fetch pipeline. It improves information presentation, but does not claim a smaller network/startup budget. Reducing background work would require a separately measured change.
- Homepage geometry is responsive and module contents can expand/collapse. Arbitrary panel resizing/reordering remains in the advanced workspace.
- Some advanced modules have specialized internal interaction surfaces. The homepage removes the generic panel scrolling container; it does not rewrite every upstream chart, table or video component.
- Home relies on the existing `dashboard.html` SPA fallback at `/`. No nginx, production Compose, public hosting, paid API, or infrastructure configuration was changed.
- Rollback is a source revert; no data migration is required. AGPL-3.0 and World Monitor attribution remain visible.
