# PlanetSlam Earth — phases 1–3

Earth is the PlanetSlam edition for weather, natural hazards, official alerts,
Earth news and webcams. Open `/dashboard?variant=earth` or choose **Earth** in
the desktop or mobile edition switcher. Existing editions and saved layouts use
the existing variant ownership rules.

## What is included

- A dedicated Earth map and independent hazard/webcam toggles. Event locations
  render on the SVG, deck.gl and globe maps. Records without coordinates remain
  available in the event lists. An accessible location selector offers the same
  selection action as a map marker.
- Reported earthquakes, tracked natural events and official alerts, with hazard,
  region, severity and time filters. Magnitude is not an impact severity rating.
  An unknown severity remains unknown.
- MET Norway forecasts for 12 selectable cities, three NOAA river gauges and
  reuse of the existing optional air-quality integration. Forecast weather is
  clearly identified as modelled conditions, separate from station observations.
- RainViewer precipitation radar through the shared weather layer on the desktop
  deck.gl flat map. SVG/mobile and globe views do not render radar. Provider
  coverage varies. Radar is a direct tile/metadata integration; the Earth event
  endpoint remains cache-only.
- Earth news with hazard, region and official/reporting filters, publisher dates,
  original links and exact duplicate grouping. Selected events show matching
  source references or explicitly labelled regional context when available.
- Nine curated official webcams across volcano, mountain, river, coast and
  weather categories. Filters and saved favorites work without connecting media.
  Selecting an event can narrow the directory to cameras within 250 km.

Selecting a map location reveals its source record. Selecting an event opens its
details, related reporting and nearby-camera action. Selecting a camera focuses
its catalog card without starting playback. Deferred panels replay the latest
selection after mounting. Camera locations provide geographic context; neither
proximity nor successful playback verifies an event.

## Source availability and limits

See [Earth providers](./earth-providers.md) for endpoints, regional coverage,
source-specific refresh intervals and maximum usable ages. See
[Earth webcams](./earth-cameras.md) for camera operators, rights, snapshot cadence
and playback limits.

Feeds refresh independently. Invalid or failed ingestion leaves each last-good
snapshot and its clocks unchanged. The reader removes expired warnings and old
measurements. Browser consumers also age cached source metadata, so one expired
source cannot hide healthy peer sources or continue displaying as fresh.

Official warnings, forecasts and observed/tracked events carry distinct labels.
Empty results describe available coverage; they are never presented as a global
all-clear. News classification uses headline tags and does not establish that a
story refers to a particular event.

Air quality requires the existing OpenAQ/optional WAQI feed to be commissioned.
Earth does not invent station readings or treat poor air quality as evidence of
wildfire smoke. The initial release does not include a smoke-plume forecast layer,
complete global river monitoring, every local warning authority, or exhaustive
camera coverage.

## Running the worker

The app discovers the cache-only `/api/earth` handler through the existing API
route loader. Earth panels and map data are demand-loaded and stay outside the
global bootstrap payload. The worker is packaged in `Dockerfile.relay` and can be
added to the existing self-hosted stack with `compose.earth.yaml`; use a dedicated
review image tag while validating it so another service's image tag is not
replaced.

```sh
docker compose -f docker-compose.yml -f compose.earth.yaml --profile earth up -d --build earth-seeder
```

The worker uses the existing Redis REST credentials. Earth ingestion needs no
additional provider API keys. The existing air-quality worker has its own key
requirements. Application build, worker operation, browser acceptance, merge and
production deployment are separate checks.

## Verification

```sh
node --import tsx --test tests/earth*.test.m*
VITE_BRAND=planetslam npx playwright test e2e/earth-dashboard.spec.ts --project=chromium
npm run typecheck
npm run typecheck:api
npm run lint:boundaries
VITE_BRAND=planetslam VITE_VARIANT=full npx vite build
```

The browser suite uses labelled synthetic responses and covers desktop/mobile
filters, selected event reporting, nearby-camera replay, snapshot connection and
disconnection, favorites, edition navigation, layer preferences and outage retry.
Live provider checks are recorded separately from these deterministic assertions.
