# PlanetSlam Earth data providers

Earth uses a central ingestion worker and a read-only `/api/earth?dataset=...`
endpoint. Browser requests read cached snapshots; they never trigger provider
requests. All providers below are independently cached, so one outage cannot
refresh another source's last-good timestamp.

## Coverage and attribution

| Dataset | Provider and source | Coverage | Refresh / maximum usable cache age |
| --- | --- | --- | --- |
| Earthquakes | [USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Reported M2.5+ earthquakes in the past day. Detection coverage varies geographically. Magnitude and depth remain measurements; unknown impact severity stays unknown. | 5 min / 1 hour |
| Natural events | [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) | Up to 600 distinct open, curated natural events from two capped requests, including fires, volcanoes, storms, floods, drought, landslides, anomalous snow and temperature extremes when supplied. Uses the latest supplied point geometry. Polygon-only records remain listed without invented point locations. | 30 min / 24 hours |
| Impact assessments | [GDACS](https://www.gdacs.org/) | Selected global earthquake, cyclone, flood, volcano, wildfire and drought assessments. GDACS colors describe estimated humanitarian impact, not a local warning or earthquake magnitude. Credit GDACS / European Commission Joint Research Centre / UN OCHA, CC BY 4.0. | 15 min / 3 hours |
| Weather warnings | [NOAA NWS alerts](https://www.weather.gov/documentation/services-web-alerts) | Actual active land and marine alerts for the US, territories and NWS marine areas. Covers heat/cold, tornado, severe thunderstorm, winter, avalanche and coastal hazards when issued. Alerts lacking geometry remain in the list. Supplied polygons use an approximate display center. Issue time is the bulletin timestamp. | 5 min / 30 min |
| Tsunami bulletins | [NOAA NTWC](https://www.tsunami.gov/events/xml/PAAQAtom.xml) | National Tsunami Warning Center feed. Information/no-threat and cancellation messages never become warnings. Bulletins older than 24 hours are removed. Coverage is the warning center's area, not all national warning services worldwide. | 5 min / 30 min |
| Weather | [MET Norway Locationforecast](https://api.met.no/doc/locationforecast/HowTO) | Model forecasts for New York, Los Angeles, Vancouver, London, Oslo, Tokyo, Manila, Delhi, Sydney, Auckland, São Paulo and Cape Town. Includes the first available model time and 24 forecast steps, temperature, wind and hourly precipitation when supplied. | 1 hour / 6 hours; model issue age limited to 12 hours |
| River levels | [NOAA NWPS](https://water.noaa.gov/) | Observed stages and provider flood thresholds for Ohio River at Pittsburgh (PTTP1), Mississippi River at St. Louis (EADM7), and Mississippi River at Memphis (MEMT1). Values retain provider units and timestamps. No global river-level coverage is implied. | 15 min / 2 hours; observation age also limited to 2 hours |
| Air quality | Existing `climate:air-quality:v1` station cache | Reuses the existing OpenAQ and optional WAQI integration, including its commissioning and attribution requirements. Stale station observations are removed. PM2.5 does not establish that wildfire smoke caused pollution. | Existing worker cadence; Earth accepts cache and measurements up to 3 hours old |
| Earth news | [NASA Earth Observatory / NASA Science](https://science.nasa.gov/feed/?science_org=19791%2C22453), [NOAA NHC](https://www.nhc.noaa.gov/index-at.xml), [The Guardian Environment](https://www.theguardian.com/us/environment/rss) | Selected English-language feeds. Official updates and reporting remain labelled distinctly. NHC is Atlantic coverage. Topic and broad-region tags are inferred from headlines. Reporting is displayed as headline and source link, without republishing article text. | NASA 30 min / 12 hours; NHC 15 min / 3 hours; Guardian 30 min / 6 hours |

## Extended hazard coverage

Phase 4 uses the providers above with dedicated categories and compound-hazard
filter tags. It does not infer an extreme-temperature event from the 12 city
forecasts. Original alert names, severity and mode remain visible.

| Category | Source and interpretation | Limits |
| --- | --- | --- |
| Heatwaves and extreme heat | NWS heat watches, warnings and advisories; EONET temperature-extreme events whose title identifies heat. | NWS coverage is regional; no universal temperature threshold or global heatwave index is inferred. |
| Extreme cold and frost | NWS cold, wind-chill, freeze and frost products; EONET temperature-extreme events whose title identifies cold. | A generic EONET temperature-extreme record stays under Weather if heat/cold cannot be distinguished. |
| Drought | GDACS drought impact assessments and selected EONET drought events. | No global rainfall-deficit, soil-moisture or drought-index raster; impact assessments are not local water restrictions. |
| Tornadoes | NWS tornado watches/warnings and explicitly identified EONET storm titles. | Warning/watch coverage does not establish that a tornado was observed. |
| Hail and lightning threats | NWS explicit HAZARD sections; a positive `maxHailSize` parameter also supplies a hail tag. News headlines can carry inferred topic tags. | A thunderstorm warning alone adds neither tag. Generic safety instructions do not create hazard tags. No lightning-strike network, radar-derived hail observations or strike playback. |
| Winter storms | NWS winter, snow, blizzard and ice-storm products; selected EONET anomalous snow events. | Warning coverage and curated events, not global snow-depth measurements. |
| Landslides | Selected EONET landslide events and explicit NWS HAZARD sections. | No complete landslide inventory or global slope-failure forecast. |
| Avalanches | NWS avalanche advisory/watch/warning products; an EONET landslide event only gains an avalanche tag when its title explicitly identifies one. | EONET's landslide category includes several kinds of mass movement; its presence alone never establishes an avalanche. No global avalanche danger rating or snowpack model. |
| Coastal and marine hazards | NWS coastal/lakeshore flood, storm-surge, high-surf, hazardous-seas, rip-current, beach-hazard and selected marine products. | NWS coverage only; no global wave-height or storm-surge forecast layer. Coastal flood and surge records also remain discoverable under Flooding. |

The [EONET category catalog](https://eonet.gsfc.nasa.gov/api/v3/categories)
defines drought, landslides (including avalanches), snow and temperature extremes.
Earth requests up to 300 open events across the catalog and up to 300 more
from drought, landslide, snow and temperature-extreme categories. The second
fixed request prevents rare categories from being crowded out by wildfire
entries. Records are merged by the original EONET event ID, retaining the newest
geometry; both responses must validate before the source is refreshed. Sparse
categories may still have no returned records. EONET category assignments govern classification; wildfire
place names such as Cold Springs do not become cold-weather events. Titles refine
ambiguous temperature, landslide and severe-storm categories only.

The [NWS alert-type catalog](https://api.weather.gov/alerts/types) defines the
products exposed by the existing active-alert endpoint. Compound tags make one
bulletin discoverable under several hazards without turning it into several
events. News tags remain headline-based browsing hints, separate from official
warning classifications. Empty category results never establish an all-clear.

MET Norway data is licensed under **CC BY 4.0**. Display credit to MET Norway and
link to its source. The [MET Norway FAQ](https://api.met.no/doc/FAQ) explicitly
permits commercial use within the service terms. Earth identifies itself using a
contact-bearing User-Agent, uses two-decimal coordinates, and caches centrally.
Weather values describe a model forecast; they are not observations from a
weather station. Missing hourly precipitation is unknown rather than zero.

News duplicates are grouped by canonical URL or an exact normalized headline on
the same publication day. Alternate URLs are preserved. This does not infer that
all similarly worded reports describe the same incident. Dates, publishers and
source links remain visible.

The NASA Earth Observatory RSS address currently redirects to a NASA Science
feed whose root tag omits whitespace between two namespace attributes. Earth
uses the final NASA Science URL and repairs that exact root-attribute defect
before normal XML validation. XML with declarations of document types or custom
entities is rejected.

## API contract

Datasets are `earthquakes`, `events`, `alerts`, `weather`, `rivers`, `airquality`,
`news`, `history`, and `health`. Unknown dataset names are rejected. Only GET and OPTIONS
are accepted, with the existing origin policy.

Each envelope includes `dataset`, `status`, `provider`, `sourceUrl`, `coverage`,
`fetchedAt`, `observedAt`, `expiresAt`, optional `message`, and
`data: { items, sources }`. Health instead returns dataset metadata as its items,
including each dataset's source statuses. Metadata remains available during
outages, while unavailable feeds contribute no event or measurement items.

`fetchedAt` records successful ingestion. `observedAt` is a provider observation,
model issue time, event report time, or bulletin/article publication time,
depending on the dataset. A successful fetch does not imply a recent event.
Source-level clocks are authoritative for mixed-provider datasets. Source metadata
also includes `staleAt` and observation-aware `expiresAt` timestamps so cached
clients can age individual providers without hiding still-valid peers. `fresh` means
all configured sources for a dataset are recent; `stale` means some are delayed or
unavailable; `unavailable` means none are usable. Expired warnings are removed on
read even between ingestion runs.

Broad map browsing regions are approximate geographic groups, not reverse
geocoded national borders. Event details retain the source's actual title and
location description. EONET's open state is a catalog state and should not be
interpreted as confirmation of an active local emergency.

## Recorded history API

`/api/earth?dataset=history` is a cache-only reader of `earth:history:v1`.
Its envelope contains `data: { items, events }`: `items` are capture frames with
`recordedAt`, source-status metadata, `eventKeys`, `totalEvents` and `truncated`;
`events` are shared `{ key, event }` revisions referenced by those frame keys.
An event retains its original observation time, mode and warning expiry.
Historical warnings never return to the current-alert datasets.

The worker captures at most once per hour and keeps up to seven days/168 frames,
500 events per frame, 4,000 distinct revisions and 2 MiB total. Records prioritize
severity and then recency when a frame exceeds capacity. Capacity eviction can
shorten the retained date range; frame truncation remains explicit. Old frames
outside the retention window disappear on read. Recording begins when the new
worker is enabled; there is no backfill or interpolation across missed captures.
A source outage remains visible in its frame metadata. If every event source is
unavailable, the worker preserves the archive without inventing an empty frame.

`fresh` history means a capture is less than two hours old, not that its records
are current alerts. Delayed recording is labelled `stale`. The archive uses a
separate lock and atomic seed-metadata publication; failed reads, invalid state
or failed writes cannot advance the last-good archive clock. No extra provider
requests are needed to record history.

## Worker operation

The optional Compose override adds only the Earth worker:

```sh
docker compose -f docker-compose.yml -f compose.earth.yaml --profile earth up -d --build earth-seeder
```

The worker uses the existing Redis REST URL and token. These remain server-side.
No additional weather or disaster API keys are required. Air quality remains a
separate existing integration: commission the existing OpenAQ worker and key
(and optional WAQI key) to populate its shared cache. Earth does not silently
start or reconfigure that integration.

Each Earth source uses a lock and a durable NX/PX refresh admission key. Each
successful publish writes both its snapshot and companion seed metadata
atomically. Failed fetches, invalid data and partial outages never overwrite a
last-good snapshot or move its clock. Logs contain source IDs and result counts,
not raw payloads, URLs with credentials or secret values.

Earth keys use `earth:<dataset>:<source>:v1`; metadata uses the existing
`seed-meta:<key>` contract. Air quality reads its established cache key directly
without writing it. USGS, NWS and GDACS feed-generation timestamps are checked before publication;
a successful HTTP fetch cannot make an old provider response fresh. Malformed
nonempty record collections cannot be published as empty success.

Source refresh intervals survive worker restarts because
admission is stored in Redis.

## Verification and operational limits

Run the focused provider, freshness, ingestion and API tests:

```sh
node --test tests/earth-data.test.mjs tests/earth-providers.test.mjs tests/earth-history.test.mjs
```

Synthetic checks exercise malformed upstream data, safe URLs, independent clocks,
expired warning removal, unknown severities, no-threat tsunami statements, model
forecast semantics, gauge thresholds, existing AQ cache reuse, locks, cooldowns,
failed-write preservation, API method validation and cache-only reads. They do
not prove live provider availability, browser camera playback, or deployment.

Live checks during implementation verified the USGS, EONET, GDACS RSS, NWS,
NTWC, MET Norway, NOAA gauge and NASA/NHC news endpoints. The Guardian endpoint
must use its final `/us/environment/rss` URL because `/environment/rss` redirects.
Provider availability and camera playback should be checked again in the review
and production environments. No production change is implied by these checks.

## Bespin air-quality commissioning

Set `OPENAQ_API_KEY` in the protected deployment `runtime.env`. The key is mapped
only into a dedicated `air-quality-seeder` service; it is not needed by the
browser, application service, or Earth event worker. `WAQI_API_KEY` remains an
optional supplement and is not required for OpenAQ ingestion.

The full relay image packages `scripts/seed-health-air-quality.mjs`. Bespin uses
its existing `provider-seed-runner.mjs` to run that importer immediately and then
on a 3,600-second interval. The runner redacts secret values from child output
and bounds each run. The importer uses a Redis lock to avoid overlapping runs.
Restarting the scheduled service reloads changed environment-file values.

A successful import writes both `health:air-quality:v1` and
`climate:air-quality:v1`, with their seed metadata. Earth reads the climate cache
through `/api/earth?dataset=airquality`; no application restart is needed.
Verify actual station observations, API freshness and the rendered Earth panel
separately from container startup. A provider may have no recent measurements
for a particular location.

OpenAQ readings retain PM2.5 concentration and measurement times. Their displayed
AQI is an estimate derived from the latest concentration using the
[current EPA PM2.5 breakpoints](https://aqs.epa.gov/aqsweb/documents/codetables/aqi_breakpoints.html),
which took effect in May 2024. It is not an official daily AQI or EPA NowCast.
The product index is capped at 500 and preserves the existing four risk buckets.

## Event status changes

Phase 5 adds two independently cached sources to the `changes` dataset. Neither
is included in the active-event map or treated as a new current warning.

- NWS recent cancellation index: `https://api.weather.gov/alerts?status=actual&message_type=cancel&limit=500`.
  Refresh every five minutes, maximum usable cache age 30 minutes. Up to 500
  messages from the recent index are restricted to the past seven days. Actual
  cancellation messages retain their CAP predecessor identifiers. The original
  cancellation message's expiry does not remove the status record. A cancellation
  can accompany a replacement warning and does not establish recovery. NWS
  collection `updated` means last collection change, so a quiet index can have an
  old value; HTTP Date/Age are checked when supplied rather than treating that
  content timestamp as response generation.
- NASA EONET closed-event query: `https://eonet.gsfc.nasa.gov/api/v3/events?status=closed&days=7&limit=300`.
  Refresh every 30 minutes, maximum usable cache age six hours. Up to 300 closed
  records from EONET's seven-day event query, restricted to closure dates within
  seven days. EONET closure is a curation decision, not an observed all-clear;
  query and record limits can omit closures.

The same cache-only Earth endpoint reads these snapshots. Saved user coordinates
are never part of provider requests. Browser consumers also age terminal records
and preserve independent source availability. Existing NWS active updates retain
CAP references so the local tracker can connect replacements across identifiers.
