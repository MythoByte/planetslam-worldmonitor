# PlanetSlam Earth data providers

Earth uses a central ingestion worker and a read-only `/api/earth?dataset=...`
endpoint. Browser requests read cached snapshots; they never trigger provider
requests. All providers below are independently cached, so one outage cannot
refresh another source's last-good timestamp.

## Coverage and attribution

| Dataset | Provider and source | Coverage | Refresh / maximum usable cache age |
| --- | --- | --- | --- |
| Earthquakes | [USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Reported M2.5+ earthquakes in the past day. Detection coverage varies geographically. Magnitude and depth remain measurements; unknown impact severity stays unknown. | 5 min / 1 hour |
| Natural events | [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) | Up to 300 open, curated natural events, including fires, volcanoes, storms and floods. Uses the latest supplied point geometry. Polygon-only records remain listed without invented point locations. | 30 min / 24 hours |
| Impact assessments | [GDACS](https://www.gdacs.org/) | Selected global earthquake, cyclone, flood, volcano, wildfire and drought assessments. GDACS colors describe estimated humanitarian impact, not a local warning or earthquake magnitude. Credit GDACS / European Commission Joint Research Centre / UN OCHA, CC BY 4.0. | 15 min / 3 hours |
| Weather warnings | [NOAA NWS alerts](https://www.weather.gov/documentation/services-web-alerts) | Actual active alerts for the US and territories. Alerts lacking geometry remain in the list. Supplied polygons use an approximate display center. Issue time is the bulletin timestamp. | 5 min / 30 min |
| Tsunami bulletins | [NOAA NTWC](https://www.tsunami.gov/events/xml/PAAQAtom.xml) | National Tsunami Warning Center feed. Information/no-threat and cancellation messages never become warnings. Bulletins older than 24 hours are removed. Coverage is the warning center's area, not all national warning services worldwide. | 5 min / 30 min |
| Weather | [MET Norway Locationforecast](https://api.met.no/doc/locationforecast/HowTO) | Model forecasts for New York, Los Angeles, Vancouver, London, Oslo, Tokyo, Manila, Delhi, Sydney, Auckland, São Paulo and Cape Town. Includes the first available model time and 24 forecast steps, temperature, wind and hourly precipitation when supplied. | 1 hour / 6 hours; model issue age limited to 12 hours |
| River levels | [NOAA NWPS](https://water.noaa.gov/) | Observed stages and provider flood thresholds for Ohio River at Pittsburgh (PTTP1), Mississippi River at St. Louis (EADM7), and Mississippi River at Memphis (MEMT1). Values retain provider units and timestamps. No global river-level coverage is implied. | 15 min / 2 hours; observation age also limited to 2 hours |
| Air quality | Existing `climate:air-quality:v1` station cache | Reuses the existing OpenAQ and optional WAQI integration, including its commissioning and attribution requirements. Stale station observations are removed. PM2.5 does not establish that wildfire smoke caused pollution. | Existing worker cadence; Earth accepts cache and measurements up to 3 hours old |
| Earth news | [NASA Earth Observatory / NASA Science](https://science.nasa.gov/feed/?science_org=19791%2C22453), [NOAA NHC](https://www.nhc.noaa.gov/index-at.xml), [The Guardian Environment](https://www.theguardian.com/us/environment/rss) | Selected English-language feeds. Official updates and reporting remain labelled distinctly. NHC is Atlantic coverage. Topic and broad-region tags are inferred from headlines. Reporting is displayed as headline and source link, without republishing article text. | NASA 30 min / 12 hours; NHC 15 min / 3 hours; Guardian 30 min / 6 hours |

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
`news`, and `health`. Unknown dataset names are rejected. Only GET and OPTIONS
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
node --test tests/earth-data.test.mjs tests/earth-providers.test.mjs
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
