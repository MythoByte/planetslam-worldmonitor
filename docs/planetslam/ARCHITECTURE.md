# Architecture and scope

## Observed baseline

The supplied `/home/mythobyte/dev/planetslam` directory was empty. Existing development source was found at `/home/mythobyte/dev/repos/planetslam`, clean at `8995f5d`; its origin is private `MythoByte/planetslam`. It is a separate React/Vite application, not a World Monitor checkout. Its quality workflow runs lint, formatting, TypeScript, tests, build, Chromium smoke and npm audit. It contains no automatic production deployment step.

Its README and `docs/DEFAULT-18002.md` describe historical Mustafar staging on port 18002, private cyber/conflict dependencies, an RFM broker workflow and separate Bespin release authorization. `docs/release/DEPLOYMENT-RUNBOOK.md` describes an older Forgejo source authority, loopback origin and existing tunnel. These records disagree on source authority and are dated; **live hosting, current release identity and production workflow were not verified**. Neither existing checkout nor those services were changed. Resolve ownership and actual topology before any staging or release decision. No production SSH, DNS or tunnel changes were performed.

## Foundation path

The new public `MythoByte/planetslam-worldmonitor` fork preserves upstream Git history, with local `upstream=https://github.com/koala73/worldmonitor.git` and `origin=https://github.com/MythoByte/planetslam-worldmonitor.git`. Baseline: `fb266469d595b4626e420236bbfa57fed4587263` (World Monitor 2.11.7). A draft PR targets the fork's own main branch, not the original PlanetSlam repository or upstream.

Browser -> existing generated RPC clients -> existing Vite local handlers / self-hosted sidecar -> existing cache readers -> upstream seeders -> provider APIs. Optional hosted Clerk/Convex/paid providers remain upstream capabilities, not prerequisites for anonymous dashboard access. This prototype adds no SQL database, ingestion engine, login requirement or paid account. Redis is the upstream cache, required for seeded feeds; the optional disposable development cache has no persistent volume.

## Brand seam

`VITE_BRAND=planetslam` selects identity in `src/config/brand.ts`; unset retains World Monitor. `src/styles/planetslam.css` centralizes Deep Space tokens, maps them onto upstream semantic variables and scopes every rule to `html[data-brand="planetslam"]`. `public/branding/planetslam/mark.svg` is an original code-native asset. Light mode retains the upstream palette with accessible cyan/amber/red overrides. Theme preference, Auto system changes and persistence reuse the upstream implementation and keys.

`branding/vite-plugin.ts` sets dashboard HTML identity and noindex, removes dashboard canonical claims and supplies the SVG icon. Small hooks in Vite, main, panel layout and banner select the brand and suppress the upstream Pro launch promotion. The brand HTML transform also disables its prepaint reservation to prevent a blank strip. New visits default to the existing 2D map. Explicit stored map choice wins, and upstream capability/failure fallbacks stay in place. Existing responsive panels, map controls, search, layer selection and feeds are reused. Other upstream marketing/reference pages and PWA identities are retained unless explicitly documented as customized: this is a dashboard foundation, not a complete public-site rebrand.

## Module availability

PlanetSlam hides locked upstream premium panels and their upgrade entry points. It also hides a module when its panel reports a request/configuration failure or an unavailable data badge, or when all of its health-mapped sources report errors, disabled status, or confirmed missing data. The same session-only state filters panel settings. It never infers server API-key configuration from browser secrets.

Unknown source health, usable stale data, successful empty event feeds, and panels with a working fallback remain visible. Hidden modules retain their saved enabled state and remain eligible for scheduled probes; a successful render or recovered health restores them. The policy covers existing explicit panel and mapped-health signals, not a complete independent provider inventory. Modules without such evidence are left visible until they report a failure. Default World Monitor builds retain their upstream behavior.

## Local navigation and source selection

PlanetSlam maps World Monitor navigation links only to local pages present in the deployed HTML inventory. Dashboard edition links preserve their edition/query parameters. Missing documentation, status and MCP destinations are removed; hosted billing/auth destinations are not offered. The live audit found documentation URLs returning the dashboard with HTTP 200, which is not treated as a valid documentation page. Generated static HTML and dynamically hydrated links use the same policy. API/provider transports and authentication contracts are independent of navigation mapping.

All anonymous PlanetSlam users can enable any number of available news sources, individually or with Select All. Reload reconciliation restores only disables owned by the former 80-source gate and preserves explicit user disables. This bypass applies only to source selection; it does not grant upstream paid API entitlements. Default World Monitor builds retain their original source cap and navigation.

## Untrusted data

Provider payloads, headlines, embedded streams, coordinates and URLs are untrusted. Keep upstream schema validation, bounded fetches, cache isolation, sanitization, safe HTML boundaries and URL checks; do not interpolate feed content into branding markup. No new raw HTML rendering or proxy is added. RSS/Telegram availability is not truth verification. LLM output is advisory and must never be an execution instruction. Before public staging, review CSP destinations, streaming embeds and direct browser fetches; reject credentials in VITE_* except explicitly public configuration such as a publishable identifier.

## AGPL and source offer

Retain LICENSE, upstream author credit and original notices. The branded footer links to the public fork and explicitly says Powered by World Monitor. A later deployed release must link to corresponding source for the exact running revision, including build/install instructions and changes, with no private-only dependencies needed to rebuild. Tag the reviewed commit and keep the source URL available to every network user. Review dependency notices and provider attribution separately. Fork publication and the requested draft PR are source delivery, not authorization to publish a site.
