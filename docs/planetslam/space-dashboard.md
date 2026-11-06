# PlanetSlam Space dashboard

Space is a PlanetSlam edition at `/dashboard?variant=space`. It uses the existing
edition switcher, panel layout, settings persistence, theme, and map renderers.
There is no separate upstream Space hostname.

## Delivered scope: phases 1–4

- Foundation: eleven movable/resizable panels, shared cached data, attribution,
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
- Aurora: native geographic forecast overlay with persistent toggle and source
  timestamps on DeckGL, SVG and Globe. A forecast does not guarantee visibility.
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
  pipeline remains separate. Pass predictions, missions, personalized observing,
  notifications, and AI daily briefs belong to later phases.

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

An atomic shared Redis admission token limits attempts across worker replicas and
restarts. Launch Library uses one upcoming-launch request per 15 minutes without
pagination fanout, leaving room within its documented 15/hour unauthenticated
allowance. Request and lock timeouts bound failure impact. No raw provider errors
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

## Operator setup

The implementation does not enable a worker, change existing deployment Compose,
restart retired systemd units, or deploy the dashboard automatically.

Set these server-side values through the deployment's existing secret mechanism:

- `NASA_API_KEY`: NASA Open APIs key for APOD, NeoWs, and DONKI; not the FIRMS key.
- `SPACEDEVS_API_KEY`: optional Launch Library entitlement. Polling stays conservative.
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
