# PlanetSlam Earth — phases 1–4

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
- Extended hazard filters for heat, cold, drought, tornadoes, lightning, hail,
  winter storms, landslides, avalanches and coastal hazards. **Explore extended
  hazards** in the event and alert panels shows the number of available records
  for each category before other filters. Compound records retain their source
  identity and can appear under several hazard tags.
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

Air quality reuses the centrally commissioned OpenAQ feed, with optional WAQI
configuration supported by the existing worker. Earth does not invent station
readings or treat poor air quality as evidence of wildfire smoke. The initial release does not include a smoke-plume forecast layer,
complete global river monitoring, every local warning authority, or exhaustive
camera coverage.

## Extended hazard coverage

The dedicated hazard categories describe records returned by the existing
providers. GDACS covers selected significant drought events worldwide; it does
not supply a continuous drought index. NASA EONET includes curated drought,
landslide, snow and temperature-extreme events. Its landslide category can
include avalanches. Curation can be sparse and is not an exhaustive inventory.

NWS warnings add United States, territory and marine service-area coverage for
heat, cold, tornadoes, winter weather, avalanches, debris flows, coastal flooding,
storm surge, high surf and hazardous seas. Lightning and hail tags require
explicit source information; a generic thunderstorm alert does not establish a
hail occurrence or lightning-strike position. Compound hazards are listed once
and remain searchable under their individual tags. No global lightning network,
hail swath, avalanche danger forecast or wave-observation grid is implied.

Choosing a hazard shows its coverage limits next to the filters. Counts describe
available records in that panel's feeds before filtering. Event panels contain
observed or tracked events; official warnings appear in Earth alerts. An empty
category, including avalanche records, does not establish safe conditions.

## Event history and map playback

Open the Earth map controls and choose **Explore event history** to browse recorded snapshots.
The timeline plays actual archived snapshots, with their capture time and source
availability. Historical alerts retain their original issue and expiry times;
playback does not make them current warnings. Return to live mode to see the
current feeds. Recorded events without coordinates remain accessible in the
recorded-event list. Webcam markers appear in current mode; webcam footage is
not archived.

The Earth worker captures a frame at most once per hour. History begins when the
updated worker is enabled: there is no reconstructed history or backfill before
commissioning, and missing captures are not interpolated. The archive retains up
to seven days and 168 frames, subject to storage limits. Each frame includes up
to 500 events, prioritizing severity and then recency; truncation is identified.
The archive shares up to 4,000 event revisions within a 2 MiB bound. Whole oldest
frames are removed when capacity is reached, so the retained span can be shorter
than seven days.

Each capture records source status and coverage. A frame can be partial; a
capture with all event sources unavailable is skipped. An archive refresh delay
is shown after two hours, while retained historical frames remain viewable until
the seven-day retention limit. Archive availability is separate from live-feed
availability, and no frame or empty category establishes an all-clear.

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

The browser suite uses labelled synthetic responses and covers extended-hazard browsing,
recorded-frame scrubbing, play/pause, source gaps, archive limits, return to current events,
and desktop/mobile
filters, selected event reporting, nearby-camera replay, snapshot connection and
disconnection, favorites, edition navigation, layer preferences and outage retry.
Live provider checks are recorded separately from these deterministic assertions.
