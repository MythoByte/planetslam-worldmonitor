# PlanetSlam Space dashboard

Space is a PlanetSlam edition at `/dashboard?variant=space`. It uses the existing
edition switcher, panel layout, settings persistence, theme, and map renderers.
There is no separate upstream Space hostname.

## Delivered scope: phases 1–6

- Foundation: fourteen movable/resizable panels, shared cached data, attribution,
  observation/fetch times, explicit fresh/stale/unavailable states, source status.
- Space Live: on-demand NASA ISS and independent NASASpaceflight Starbase/Space
  Coast players, source links, saved favorites, offscreen pause and disconnect.
  Official NASA/SpaceX mission coverage is linked separately. No camera is called
  live until the existing player verifies it; embedding may be blocked upstream.
- NASA Picture of the Day: seven recent days, image credit, explanation, full-size
  link, and video-day source fallback. APOD can contain third-party copyrighted work.
- Space News: Spaceflight News API plus NASA/ESA feeds, topic filtering, excerpts,
  publisher and original links. SpaceX Watch combines filtered news and launches.
- Launch Countdown: next launches, NET times, launch windows, provider status,
  vehicle, payload, pad, webcast link, and native map markers.
- Space Weather: NOAA G/R/S scales, Kp, solar wind/Bz, recent trends and bulletins.
- Aurora: cached NOAA geographic forecast with a persistent toggle in the main
  layer selector on DeckGL, SVG and Globe. A forecast does not guarantee visibility.
- Sun Now: three NASA SDO wavelength images, file update times and required credit.
  HTTP Last-Modified is a file update proxy, not a guaranteed instrument timestamp.
- Solar events: seven days of NASA DONKI flare/CME history and source links.
- Near-Earth Objects: seven days of approaches, estimated size range, lunar/km miss
  distance, velocity and classification. Potentially hazardous is not an impact
  prediction.
- Satellite Tracker: searchable names and NORAD IDs, ISS selected by default,
  curated Stations/Weather/Science/Communications (GEO)/Starlink groups, selected
  calculated position and ground track, orbit details, source and element age.
  The Space tracker consumes CelesTrak GP JSON/OMM with SGP4; it does not depend
  on five-digit legacy TLE identifiers. The existing World intelligence satellite
  pipeline remains separate.
- Mission Events: dockings, spacewalks, landings, briefings and other events from
  Launch Library 2, preserving the provider's date precision and estimate status.
  Day/month/quarter/year estimates stay visible until their UTC period ends;
  coarse dates never become an invented precise launch window.
- Tonight's Sky & Observing: approximate Moon phase/illumination; explicit local
  observer coordinates; 24/48-hour selected/watched satellite passes, rise/peak/set,
  directions and ISS visibility candidates.
- Personal watchlists for satellites, launches and mission events, each with a
  maximum list length of ten; camera favorites remain in Space Live.
- Optional browser reminders: explicit permission and opt-in, watched events and
  visible pass opportunities, schedule changes and duplicate suppression. These
  work while this dashboard is open; no closed-page, email or push service exists.
- Space Daily Brief: a shared, source-linked daily briefing with optional AI
  synthesis, a labeled source-summary fallback, and explicit coverage gaps.
  The PlanetSlam map controls and page-author metadata credit MythoByte.

## Data path and failure behavior

`provider → seed-space worker → validated Redis snapshot + atomic seed-meta →
GET /api/space?dataset=<name> → shared browser service → panel/native map overlay`

The read-only endpoint never starts provider fetches. Browser requests for the
same dataset share a short cache and in-flight request. New Space datasets stay
off the global bootstrap payload; other editions incur no Space provider work
unless a visitor explicitly adds a Space panel.

The worker retains last-good data on fetch/validation failure, with its original
clock. The API labels delayed snapshots stale and hides expired data. Weather,
aurora and solar snapshots also check observation/file-update age independently
of fetch age. Missing observations never become zero severity or an empty sky.
`dataset=health` returns all dataset states, even when all are unavailable.

| Dataset | Scheduled attempts | Maximum retained age |
| --- | --- | --- |
| APOD | 6 hours | 48 hours |
| News | 15 minutes | 6 hours |
| Launches | 15 minutes | 6 hours |
| Weather | 5 minutes | 1 hour |
| Aurora | 5 minutes | 1 hour |
| Solar images | 15 minutes | 6 hours |
| DONKI events | 1 hour | 24 hours |
| NEO approaches | 6 hours | 24 hours |
| Orbital GP catalog | 6 hours per group | 48 hours per source snapshot |
| Mission events | 15 minutes | 6 hours |
| Daily brief | 5-minute readiness checks; at most one AI attempt per UTC day | 48 hours |

An atomic shared Redis admission token limits attempts across worker replicas and
restarts. Launch Library uses one upcoming-launch request per 15 minutes without
pagination fanout, and one upcoming-missions request on the same cadence. Both share a durable
12-request/hour limit (normally eight requests/hour combined), within the
provider's documented 15/hour unauthenticated allowance. Request and lock timeouts bound failure impact. No raw provider errors
are logged because NASA request URLs contain a credential.

## Satellite tracking (phase 4)

The Space worker centrally retrieves five CelesTrak groups on a six-hour cadence.
The communications selector is explicitly the GEO catalog, not a complete list of
all communications spacecraft. No browser queries CelesTrak. Per-group original
fetch times and failures remain visible: one failed group does not erase other
usable groups or imply a confirmed-empty orbital catalog. Bounded catalog subsets
report truncation and provider totals explicitly.

Positions are SGP4 calculations from mean orbital elements, not live telemetry.
Element epoch age is independent of download time. Elements older than 48 hours
are stale and elements older than seven days are excluded. These are dashboard
freshness limits, not guarantees of positional accuracy. Re-fetching an old orbit
does not reset its epoch. The selected object alone receives a detailed ground
track; group drawing is capped and updates pause while hidden to bound CPU work.
Dateline crossings are split rather than drawing a line across the whole world.

No NASA key is needed for the satellite catalog. A worker rebuild and restart is
required when deploying phase 4; an app-only update cannot populate orbital data.
Provider rejection must remain visible rather than falling back to demo orbits.

## Observing and reminders (phase 5)

Observer latitude/longitude can be entered manually. Browser geolocation is called
only after clicking Use my location. Coordinates, horizon and watchlists stay in
local browser storage; coordinates are not included in PlanetSlam API requests.
Clearing/changing the observer aborts previous calculations and invalidates its
reminder candidates. Saved location is not silently synchronized to a server.

The engine predicts at most ten distinct selected/watched satellites over 24 or
48 hours, yields between bounded calculation batches, and supports cancellation.
Rise/set use the geometric horizon; passes must peak at least ten degrees above
it. A possible visual window additionally requires a satellite at least ten
degrees high, fully sunlit, with the observer's Sun at or below minus six degrees.
Finite Earth/Sun disks conservatively exclude penumbra. Clouds, terrain, buildings,
refraction, brightness, manoeuvres and precise ephemeris corrections are not
modelled. These are viewing candidates rather than visibility guarantees.

Source/element expiry clips predictions; ongoing and unresolved/clipped pass ends
are explicit. Source confidence is assessed per object, so unrelated older
spacecraft in a group do not downgrade a fresh ISS calculation. Moon phase uses
an approximate geocentric lunar orbit/perturbation model; cycle age is a phase
angle estimate rather than the exact elapsed time since a new Moon. The supported
astronomical model range is 1900–2100.

Reminders default off and request notification permission only from the Enable
button. Denied/unsupported browsers retain the rest of the dashboard. Delivery is
page-open and best effort; browsers may delay background-tab timers. There is no
service-worker push subscription or email integration. Initial reminders use a
five-minute window for watched Go-for-launch schedules, second/minute-precision
mission events and fresh visible pass opportunities. Coarse estimates can produce
informational schedule-change notices, never precise five-minute reminders.

Every delivery rechecks watches, permission, current source data and observer
identity. Pass predictions can remain usable in an open background tab while the
underlying element epoch still matches the current catalog; new elements suppress
old predictions until recalculated. Stale/expired sources and changed/cleared
locations suppress reminders. A local bounded delivery ledger, pass-time jitter
coalescing, native tags and Web Locks where available reduce duplicate delivery
across refreshes and cooperating tabs. Native tags do not include raw observer
coordinates. Closing the final observing panel stops its timer and suppresses in-flight deliveries.

## Daily brief (phase 6)

The Space worker prepares one shared UTC edition from the same cached snapshots
used by the panels. The browser only reads `dataset=brief`; refreshing it cannot
start an AI call or fetch a provider. Observer locations, watchlists and other
personal browser settings never enter the brief inputs.

Every section links to identified source snapshots. The brief records generation,
fetch and observation/publication times, source coverage and missing feeds.
Unavailable feeds do not become reassuring zero counts or claims of no hazards.
Changing launch/mission schedules and space weather remain estimates at the stated
source time; the individual panels show more recent updates during the day.

Optional AI synthesis uses the existing server-side OpenRouter transport with a
bounded prompt, output, timeout and one admitted AI attempt per UTC day across
worker replicas. Only citation IDs supplied with the input can be returned;
links come from the original cached sources. Missing AI configuration, transport
failure or invalid output produces an explicitly labeled source summary. A brief
with no usable evidence remains unavailable. There are no viewer-triggered AI costs.

Previous-day editions are labeled stale and expire after 48 hours. Original
source clocks remain visible and age independently. A fresh brief timestamp does
not reset an older provider observation. AI summaries can be wrong; use the cited
sources to check details.

## Release acceptance

The focused acceptance checks exercise the existing ingestion/cache/API path,
source freshness and outages, satellite math, observer privacy, opt-in reminders,
camera lifecycle, watchlist persistence and the daily brief's citations and
fallback. Desktop/mobile browser checks use labeled synthetic fixtures; provider
availability must also be verified independently when deploying.

The brief is loaded as a deferred panel. Other editions retain their normal
startup, and no Space data is added to the global bootstrap. Orbital calculation
limits and cancellation remain in place. Production chunk and service-worker
tests enforce the existing 32-file / 2 MiB precache budget. Browser checks cover
keyboard-accessible controls, content escaping, readable source labels, responsive
width and actual 2D/3D map credits.

Release gates: browser/API typechecks, architectural and Safe HTML/storage/panel
guards, Space producer/reader and DOM suites, strict Space browser acceptance,
production build, PWA/chunk checks and generated-file freshness. Passing fixtures
does not commission every optional provider or establish live forecast accuracy.

## Operator setup

The implementation does not enable a worker, change existing deployment Compose,
restart retired systemd units, or deploy the dashboard automatically.

Set these server-side values through the deployment's existing secret mechanism:

- `NASA_API_KEY`: NASA Open APIs key for APOD, NeoWs, and DONKI; not the FIRMS key.
- `SPACEDEVS_API_KEY`: optional Launch Library entitlement. Polling stays conservative.
- `OPENROUTER_API_KEY`: optional existing server key for daily AI synthesis; without
  it the brief uses its source-summary mode. Map it explicitly into `space-seeder`.
- `SPACE_BRIEF_MODEL`: optional model override; defaults to the existing
  `deepseek/deepseek-v4-flash` configuration. This does not change the other AI panels.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: existing shared cache.

Never put provider credentials in `VITE_*`, browser configuration, or Git. With no
NASA key, the corresponding panels show unavailable; keyless sources still run.

One-shot ingestion: `node scripts/seed-space.mjs`.
Long-running scheduler: `node scripts/seed-space.mjs --loop`.

For the repository's standard self-hosted stack, the optional Compose overlay is:

```sh
docker compose -f docker-compose.yml -f compose.space.yaml --profile space up -d --build space-seeder
```

It builds the relay image with the new worker files and connects to the existing
`redis-rest` service using `REDIS_TOKEN`. Custom PlanetSlam deployments must adapt
the service/network and Redis URL to their existing topology. Avoid running a
separate worker against another Redis instance: readers and producers must agree.
Do not share admission keys across installations with different provider budgets.

After enabling, inspect worker results and `/api/space?dataset=health`, then verify
each panel's real source and observation time. A healthy process alone does not
prove that provider data is usable. Stop only the dedicated worker to roll back
collection; the endpoint naturally ages its previous snapshots out.

## Validation

Focused tests cover provider normalization, real/invalid empty responses, cached
freshness and expiry, atomic publication/admission, cache-only API behavior,
health diagnostics, coordinate validation, and relay-image import closure.
Phase 4 also checks OMM propagation against a published SGP4 reference and an
independent equivalent TLE, six-digit catalog IDs, UTC epochs, dateline seams,
source and element expiry, partial-group failures, and bounded marker workload.
Browser fixtures are visibly synthetic and exercise edition boot, desktop/mobile
layout, APOD video/archive, news filtering, favorites, overlay settings,
stale/unavailable states and retry recovery. Satellite tests cover ISS default,
NORAD search, group/selection persistence, rendered map markers/tracks, and
upgrading an existing Space layout without undoing explicitly hidden panels. Fixture evidence proves those UI
paths; it does not certify live feeds, camera playback or production deployment.

Run the focused browser suite with `VITE_BRAND=planetslam npx playwright test
 e2e/space-dashboard.spec.ts --project=chromium` using Node 24. The repository's
verification skill supports isolated manual drives and screenshots.

## Provider references

- [NASA APIs](https://api.nasa.gov/) and [APOD API](https://github.com/nasa/apod-api)
- [NASA media policy](https://www.nasa.gov/nasa-brand-center/images-and-media/)
- [NASA SDO credit rules](https://sdo.gsfc.nasa.gov/data/rules.php)
- [Spaceflight News API](https://www.spaceflightnewsapi.net/)
- [Launch Library 2](https://lldev.thespacedevs.com/docs)
- [NOAA products](https://www.spaceweather.gov/products)
- [NOAA RTSW endpoint migration notice](https://www.weather.gov/media/notification/pdf_2026/scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf)

- [CelesTrak GP JSON and OMM formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
- [Satellite.js propagation documentation](https://github.com/shashwatak/satellite-js)

- [USNO approximate solar coordinates](https://aa.usno.navy.mil/faq/sun_approx)
- [USNO altitude and azimuth](https://aa.usno.navy.mil/faq/alt_az)
- [Author description of approximate lunar orbital calculations](https://stjarnhimlen.se/comp/ppcomp.html)

## Global dashboard

PlanetSlam Global includes the shared Space blocks and the Aurora forecast and upcoming launch overlays. Existing satellite, spaceport, day/night, and webcam layers retain their single registry entries. The lightweight map also exposes its supported satellite, spaceport, Aurora, and webcam controls. Each Space block and overlay control has a distinct icon. Overlay choices persist across reloads and renderer switches; blocks use the normal panel settings controls. A one-time Global layout migration adds the Space blocks for returning visitors, after which intentional panel disables persist. Space and Earth menu entries are retired; their old edition URLs resolve to Global, using the same shared components and cache.

Aurora forecast is now a native entry in the main Layers selector, sharing its URL state and saved visibility with other layers. Spaceports controls both the static spaceport catalog and upcoming-launch markers on all renderers. The former separate Space overlays menu is removed. Existing Aurora preferences migrate into native map-layer settings.
