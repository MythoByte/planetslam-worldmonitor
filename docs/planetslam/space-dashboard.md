# PlanetSlam Space dashboard

Space is a PlanetSlam edition at `/dashboard?variant=space`. It uses the existing
edition switcher, panel layout, settings persistence, theme, and map renderers.
There is no separate upstream Space hostname.

## Delivered scope: phases 1–3

- Foundation: ten movable/resizable panels, shared cached data, attribution,
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
- Existing satellite and spaceport map layers remain available. Advanced satellite
  catalogs, OMM migration, pass prediction, missions, personalized observing,
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
`dataset=health` returns all eight dataset states, even when all are unavailable.

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

An atomic shared Redis admission token limits attempts across worker replicas and
restarts. Launch Library uses one upcoming-launch request per 15 minutes without
pagination fanout, leaving room within its documented 15/hour unauthenticated
allowance. Request and lock timeouts bound failure impact. No raw provider errors
are logged because NASA request URLs contain a credential.

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
Browser fixtures are visibly synthetic and exercise edition boot, desktop/mobile
layout, APOD video/archive, news filtering, favorites, overlay settings,
stale/unavailable states and retry recovery. Fixture evidence proves those UI
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
