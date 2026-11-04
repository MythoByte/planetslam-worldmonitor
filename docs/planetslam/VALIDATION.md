# Foundation validation

2026-11-03, Node 24.22.2, npm 11, Playwright Chromium, local isolated checkout. Saved text logs have trailing whitespace normalized. The exact UI source hashes used for these captures are in [implementation-sha256.json](evidence/implementation-sha256.json). Screenshots reflect the finished UI, including mobile source access; fixture and live results are separate.

| Check | Result | Evidence / limits |
|---|---|---|
| TypeScript | PASS | evidence/typecheck.txt |
| E2E TypeScript | PASS | evidence/e2e-types.txt |
| Architectural import boundaries | PASS | evidence/boundaries.txt |
| Safe HTML guard | PASS | evidence/safe-html.txt; zero legacy sinks |
| Strict Vite environment secret guard | PASS | Included in complete production-build log |
| Existing theme tests | PASS, 7 tests | evidence/theme-tests.txt |
| Existing renderer/theme-loader regressions | PASS, 12 tests | evidence/renderer-tests.txt; includes default flat behavior and fallbacks |
| Existing HTML/variant/PWA/deploy regression suites | PASS, 341 tests | evidence/html-pwa-tests.txt |
| Complete branded production build | PASS | evidence/production-build.txt; normal npm run build including blog/pro/corpus/TypeScript/Vite/PWA; 30 precache entries |
| Default World Monitor production bundle | PASS | evidence/default-build.txt; Vite bundle after same upstream prerequisites |
| Branded browser acceptance | PASS, 5 tests | evidence/browser.txt; desktop/tablet/mobile + two strict axe scans |
| Default World Monitor browser acceptance | PASS, 3 tests | evidence/default-browser.txt; same three widths and persistence checks |
| Theme persistence | PASS | UI light selection survives reload; Auto follows both OS schemes; dark profile used for screenshots; upstream storage reused |
| Automated accessibility | PASS | Dashboard and settings WCAG A/AA axe scans report no violations; scoped focus ring; no horizontal page overflow at 1440/768/390px |
| Live free earthquake seeder | PASS | evidence/live-earthquakes.txt; upstream seeder fetched USGS/NRCan inputs, published 124 records to isolated Redis with freshness metadata |
| Live local API/browser/globe | PASS, scoped | evidence/live-browser.txt; real 200 earthquake RPC, 124 returned USGS records, visible globe canvas, actual 2D/3D switch and settled persisted preference |
| Credential/canary output scan | PASS | evidence/bundle-secrets.json; all 1,788 dist files scanned for two server-only build canaries and actual temporary cache credentials; four values, zero matches |
| Existing PlanetSlam checkout | Untouched, clean | Read-only inspection at 8995f5d; production not accessed or changed |
| Temporary resources | Cleaned up | Skill-owned Vite process and only planetslam-foundation cache containers/network removed; no persistent volumes used |

## Screenshots

Controlled UI response captures: [desktop dark](evidence/planetslam-1440-dark.png), [desktop light](evidence/planetslam-1440-light.png), [tablet dark](evidence/planetslam-768-dark.png), [mobile dark](evidence/planetslam-390-dark.png), [mobile light](evidence/planetslam-390-light.png). The test bulletin is explicitly an acceptance fixture, not live intelligence. Upstream-default captures are also retained in evidence for comparison.

Unmocked local-feed captures: [desktop globe](evidence/01-live-desktop-globe.png), [mobile](evidence/02-live-mobile.png). These use the real upstream handlers/cache, not mocked API responses. Static infrastructure markers are upstream reference data, not current incidents.

## Known limitations and staging blockers

The real Vite drive also recorded **33 console errors, 14 warnings and 21 HTTP errors**. These are retained, not hidden by the scoped pass: missing `/api/wm-session` (404), legacy endpoint responses delivered as JavaScript/HTML rather than JSON (weather/Canada/sanctions/health), a CORS failure fetching upstream boundary overrides, and absent PizzINT data. The seismic RPC and globe/switch assertions passed independently. The prototype is not a clean whole-stack acceptance result. Vite does not provide every legacy/hosted API; full upstream sidecar/nginx commissioning is required before staging. No provider-account sign-in was required for the successful path.

The initial branded build exposed an upstream HTML-generation ordering contract. Branding now runs after variant HTML generation; the final complete normal build passes with PWA enabled. An early responsive test clicked the hidden desktop settings control at tablet width; it now uses More -> Settings. An early live switch assertion read storage before the renderer settled; it now waits for the persisted result. Final reruns above replace those incomplete attempts.

The inherited npm audit reports **38 vulnerabilities: 2 low, 36 moderate, 0 high, 0 critical** (evidence/dependency-audit-summary.json). Lockfiles/dependencies were not changed. A dependency-upgrade/security assessment remains separate pre-release work; no claim of a zero-vulnerability baseline is made.

Long-tail provider terms, quotas and redisplay rights remain unverified. No paid/key-gated capability is claimed working. No complete upstream multi-variant test matrix, native desktop package, public API uptime, staging, production deployment, DNS, browser service-worker runtime/offline test or live hosting topology was verified. Mobile globe framing retains the upstream behavior (a close view that users can zoom/rotate). Automated accessibility is not a substitute for assistive-technology review. Default regression evidence covers the touched paths, not every upstream feature.

Hosted CI was intentionally not enabled. GitHub Actions is disabled on the new fork (`enabled: false`) so inherited deployment, release and scheduled jobs cannot run. This does not change the existing PlanetSlam repository. Enable a separately reviewed CI-only workflow in later work; this PR reports local checks only.
