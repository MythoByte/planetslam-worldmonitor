# PlanetSlam Earth — phases 1–6

Earth's nine blocks, curated camera tools, additional event locations, and recorded history are included in **Global**. Space and Earth no longer appear in desktop or mobile edition menus; old `/dashboard?variant=earth` and `?variant=space` links open Global and preserve the other URL parameters.

Existing Global map layers are reused. Matching provider IDs and event permalinks retain their existing map representation; only unmatched Earth locations are added. Natural Events, Weather Alerts, Fires, and Live Webcams control their corresponding additional locations. Hazard filters in Earth details refine additional Earth locations. Recorded Earth playback does not rewind Global's shared live layers. A one-time layout migration adds the Earth blocks; later panel disables persist. Saved Earth places, camera favorites, and alert preferences keep their existing storage keys.

## What is included

- The Global map with shared layer controls and additional Earth location filters. Event locations
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
- Thirteen curated operator webcams across volcano, mountain, river, coast and
  weather categories, including five YouTube live-camera sources. Filters and saved favorites work without connecting media.
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

## My Earth: saved locations, alerts and daily brief

**My Earth** saves up to ten named latitude/longitude locations in this browser.
Choose a saved location or use **Use my location** to request browser geolocation;
location access is requested only after that button is clicked. Saved places and
preferences stay in this browser; Earth feeds use shared snapshots rather than
provider lookups with your coordinates. They are not synced to another device or
an account. Centering the map uses the existing map view and can update its URL. Remove a saved location to delete its local entry.

Choose a radius, hazard types, minimum severity and minimum earthquake magnitude.
Unknown severity has an explicit inclusion setting; magnitude remains separate
from impact severity. Nearby matching uses supplied event points or approximate
alert-area centers. Records without coordinates cannot be matched by radius.
These results do not replace local warning-area or point-in-polygon coverage.

The in-app inbox tracks new and changed matching records while the dashboard is
open. First use and preference changes establish a baseline without producing an
alert flood. Repeated provider messages are deduplicated; NWS CAP references link
replacement messages. Source outages preserve known state instead of claiming
that a hazard ended. Expiry, provider cancellation, curation closure and missing
records have distinct meanings; none implies an all-clear or verified recovery.
The inbox is local to this browser and does not send background push, email or
SMS notifications.

The daily brief is a deterministic, dated UTC summary of available matching
records from the previous 24 hours, with original sources, event times and
coverage limits. It refreshes with available data and does not invent a forecast,
local safety assessment or missing observations. Older ongoing records can still
appear in the nearby list even when outside the daily brief's time window.

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

## Loading, recovery and release checks (phase 6)

Earth starts a visible 2D WebGL renderer after a 200 ms scheduling delay, with a
500 ms idle-callback timeout, while preserving the first paint. Other editions
retain their existing schedule. Offscreen maps keep their lazy-loading backstop.
Radar metadata starts alongside the renderer import when weather is enabled.
A parsed map style can attach radar before unrelated basemap tiles finish.

The radar status shows the UTC observation frame time, loading, delayed or
unavailable state, and a retry button. Manifest requests have an eight-second
deadline, share in-flight work and reuse fresh metadata for one minute. A validated
last-good frame can be reused for up to 45 minutes, including across reloads;
failed requests do not advance its clocks. Initial failures retry after 15, 30 and
60 seconds, then retain the regular five-minute refresh. Slow tiles are identified
after 15 seconds. Unchanged frame URLs avoid unnecessary tile reloads. Radar
failures are isolated from basemap fallback.

RainViewer's public precipitation tiles use Universal Blue and a maximum source
zoom of seven, with operator attribution. Overzooming the map does not request
unsupported tile zooms. Coverage is provider-dependent. The public API no longer
supplies satellite infrared cloud imagery or nowcast frames; see the
[provider transition FAQ](https://www.rainviewer.com/api/transition-faq.html).
Current radar is separate from recorded event playback.

The globe shows event and warning locations. Its selected Earth texture starts
loading concurrently with the globe renderer code. Blue Marble is a static image,
not live cloud observations. SVG/mobile maps show event locations without radar.
The controls state these renderer and history limits explicitly.

Phase 6 also verifies that a quiet NWS active-alert collection remains usable
when its HTTP retrieval clocks are fresh: its content `updated` value records the
last collection change, rather than a new observation on every request. Missing,
invalid or future content clocks and stale transport clocks remain rejected.

See the [Phase 6 release checklist](./earth-phase6-verification.md) for exercised
paths, evidence limits and the deployment checks still required per release.

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
node --import tsx --test tests/earth*.test.m* tests/weather-radar.test.mts
VITE_BRAND=planetslam npx playwright test e2e/earth-dashboard.spec.ts e2e/earth-watch.spec.ts e2e/weather-radar.spec.ts --project=chromium
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
