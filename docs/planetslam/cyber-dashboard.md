# PlanetSlam Cyber dashboard — Phase 1

Open `/dashboard?variant=cyber` or choose **Cyber** in the PlanetSlam edition
switcher. The edition uses the shared layout/settings/theme and four movable,
resizable panels. The base map is disabled by default. No cyber map, attack counter, incident tracker, EPSS ranking,
AI brief, installed-version discovery, or notifications are included in Phase 1.

- **Cyber News:** source-linked headlines and short excerpts from BleepingComputer,
  Krebs on Security, and The Hacker News. Seven-day coverage, latest first, with
  topic and watchlist-only filters. Topics are keyword classifications, not
  independently verified incident labels. Matching URLs (ignoring tracking tags)
  are deduplicated; separate publishers' reporting stays separately attributed.
- **Exploited Vulnerabilities:** the full CISA KEV catalog, newest additions first,
  with CVE/vendor/product search, watchlist filter, required actions, reference
  links, and ransomware-use field. Unknown use remains unknown. Federal due
  dates apply to covered US federal agencies, not automatically to every visitor.
  KEV inclusion is evidence of exploitation somewhere, not proof of local exposure.
- **My Technology Watchlist:** up to 20 literal vendor/product keywords, quick-add
  choices and custom terms, with matching news and catalog entries. Preferences
  stay in browser local storage (`planetslam-cyber-watchlist-v1`), synchronize
  between same-origin tabs, and can be removed individually. No installed version
  or vulnerability scan is performed. A failed storage write is shown explicitly.
- **Cyber Data Status:** individual publisher/catalog source links, original
  successful fetch times, newest publication/catalog dates, and fresh, delayed,
  or unavailable states. A partial news outage retains other usable sources.

## Data path

`provider → seed-cyber-dashboard worker → validated Redis snapshot + atomic
seed-meta → GET /api/cyber-dashboard?dataset=news|kev|health → shared browser
service → lazy panel`

Readers never trigger provider work and Cyber data stays off global bootstrap.
Browser requests for the same dataset share an in-flight request and a short cache.
Panels refresh while mounted/visible; destroying a panel clears its timers and
watchlist subscriptions. Only the first 20 matching rows render initially; **Show
20 more** expands that bounded view.

The central worker uses the existing Redis helpers and durable attempt admission
per source. Concurrent replicas share a lock and cooldown. Fetch/normalization
failure retains the last-good snapshot and its clock. Publication atomically
writes snapshot and seed metadata. There are no provider credentials for Phase 1.
CISA's official GitHub mirror is the fallback when its primary feed is unavailable.
RSS and JSON responses have time and byte limits, and links must be HTTPS.

| Source | Scheduled attempt | Delayed after | Expires after |
| --- | --- | --- | --- |
| CISA KEV | 1 hour | 2 hours | 48 hours |
| Each news publisher | 15 minutes | 30 minutes | 6 hours |

These states describe successful retrieval, not incident detection or internet
safety. A publisher can publish infrequently while its feed is retrieved normally.
Expired/invalid data is hidden; a failed refresh cannot reset the original fetch
clock. Missing data is never represented as zero attacks or proof of safety.
The health endpoint returns each source even when all are unavailable.

## Running the worker

`node scripts/seed-cyber-dashboard.mjs` runs once; `--loop` checks every minute
and honors each source's durable cadence. Configure Redis with the existing
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` mechanism. For repository
Compose use `compose.cyber.yaml` with `docker-compose.yml` and profile `cyber`.
Rebuild the worker image when adding these files; an app update alone cannot
populate the new cache namespace. Provider failures remain visible.

## Verification

- `node --import tsx --test tests/cyber-dashboard.test.mjs tests/cyber-watchlist.test.mts tests/cyber-dashboard-api.test.mjs`
- `VITE_BRAND=planetslam npx playwright test e2e/cyber-dashboard.spec.ts --project=chromium`
- `npm run typecheck`, `npm run typecheck:api`, `npm run lint:boundaries`
- Branded Vite production build, then local Compose worker/API/browser checks.

Browser acceptance uses labeled synthetic responses for filtering, safe text,
watchlist add/remove/reload, edition navigation, layout at 1440/390px, and outage
recovery. That proves UI behavior, not live provider or production operation.
Live worker-to-cache-to-API observations and the local review browser run provide
separate evidence. Publishing to Bespin is a separate authorized action.
