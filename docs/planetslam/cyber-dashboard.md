# PlanetSlam Cyber dashboard — Phases 1–4

Open `/dashboard?variant=cyber` or choose **Cyber** in the PlanetSlam edition
switcher. The edition uses the shared layout/settings/theme and movable,
resizable panels. New profiles enable the Cyber map. Existing saved map choices
are preserved; **Show Cyber map** or an incident's **Locate on map** explicitly
enables and reveals it. Attack statistics, installed
version discovery, and notifications remain later phases.

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

## Phase 2: reported incidents and geographic layers

**Reported Cyber Incidents** displays the public recent-record sample from the
UMD GoTech Cyber Events Database. Its research publication is monthly, not a live
attack stream. The bounded adapter uses the same unauthenticated recent-record
resource as the public site and does not request authenticated downloads or bulk
exports. Cards retain the organization, source-coded sector/category/country,
original reporting link, estimated event date, report publication, and available
provider revision timestamp/change log. Account/author metadata is not published.
Reports remain **reported**, and explicit claims in the description are marked
**claim in reporting**; the dashboard does not independently verify them.

Country, sector, category, literal search, and reported/observed-period filters
are shared between the tracker and map and saved in this browser. Sector filters
apply only to incidents: an indicator IP has no inferred victim industry. The
map controls toggle the layers independently, while the incident list retains
matching records even when its map layer is hidden. **Reset filters** restores
the defaults. **Inspect map marker** provides keyboard access and centers a
chosen marker; native marker selection opens its source details. Selecting a
country recenters a matching geographic point. Dataset refresh/retry notifies
both consumers, including recovery from a partially unavailable source.

- Amber represents reported victim **country-level** positions from the existing
  country-centroid dataset. It is not an organization address. Unknown countries
  stay in the tracker and are omitted from the map; positions can overlap.
- Violet represents **approximate infrastructure geolocation** from the existing
  shared `cyber:threats:v2` collector. It is not the victim or attacker location.
  The original collector can use country-level fallback coordinates. No raw
  indicator is turned into a navigation link; indicators are defanged and only
  the trusted feed source is linked.
- The infrastructure projection is bounded, reports its source total/truncation,
  and limits geographic drawing. The mixed upstream snapshot does not supply
  completeness status for every individual provider, so none is inferred.
- SVG/mobile, DeckGL, and globe consume the same bounded geographic snapshot.
  Renderer switches rehydrate it. Filters clear a selected detail if its marker
  leaves the visible dataset. There are no simulated attack arcs or global attack
  totals. The inherited global time slider and unrelated severity legend are
  hidden for Cyber; its own reported/observed period applies to these layers.

## Phase 3: Vulnerability Attention Queue

The queue joins the CISA KEV catalog with FIRST/Empirical Security EPSS and public
CVE contributor CVSS metrics. Every queue entry already has CISA evidence of
exploitation; this is a KEV prioritization view, not a catalog of all CVEs.
Default ordering places literal technology-watchlist matches first, then higher
EPSS probability, then newest KEV addition, with CVE ID as a stable final tie.
Users can choose EPSS-first or newest-first order and filter vendor, product,
technical severity, search text, watchlist matches and additions in 7/30 days.
Changing vendor clears the product filter. Queue filters reset on reload;
technology-watchlist preferences persist and update the queue across tabs.

Each card explains the keyword match and evidence of exploitation, separates
EPSS likelihood from CVSS technical severity, retains the CISA required action,
and links the original CVE record with contributor, vector/version and revision.
A watchlist keyword is not installed-version exposure. Federal remediation dates
apply to covered US federal agencies. Unknown ransomware use is not confirmed use.

FIRST recommends its daily compressed score file for dashboards. The worker
fetches it once per 24-hour admission, validates its model/date/header and numeric
scores (including scientific notation), and retains only matches to the existing
usable KEV cache. No watchlist data leaves the browser. Reads are bounded at
15 MB compressed, 100 MB expanded and two million rows, with a 60-second request
budget. Missing EPSS IDs remain unknown; valid zero probabilities remain zero.
Source score date/model and matched/requested catalog counts remain visible.
Both retrieval age and publication age govern freshness/expiry; fetching an old
file cannot renew its scores. The **Higher likelihood** label uses a dashboard
threshold of EPSS >=10%, not a FIRST-issued action recommendation. EPSS describes
predicted exploitation activity in the next 30 days, not impact or a particular
visitor's probability of compromise.

CVSS enrichment deliberately checks only the 40 newest KEV additions every
24 hours, with two concurrent public CVE reads and a 60-second overall budget.
Coverage is explicit; other entries have Unknown severity. General base metrics
from the CNA take precedence, with ADP contributors as fallback. Within a
contributor, CVSS 4.0 precedes 3.1 then 3.0; the highest general base score within
that version is retained. Scenario-specific metrics and CVSS 2.0 are not used.
Unscored published records remain null. A failed record fetch/normalization
preserves the entire last-good CVSS snapshot and original clock.

The two enrichment feeds have independent health entries. Failure of either
retains usable KEV/watchlist prioritization; missing or expired KEV hides the
queue with an unavailable message. Refresh retries cache reads only. Visible
panels poll every minute; dataset subscriptions update consumers immediately
on recovery. Teardown removes subscriptions and the poll timer. No new API key
is required. Bulk NVD ingestion, asset discovery and notifications
remain later work.

Official references: [EPSS batch guidance](https://www.first.org/epss/data),
[CVE record schema](https://github.com/CVEProject/cve-schema) and
[public CVE records](https://www.cve.org/).

## Data path

`provider → seed-cyber-dashboard worker → validated Redis snapshot + atomic
seed-meta → GET /api/cyber-dashboard?dataset=news|kev|incidents|infrastructure|epss|cvss|brief|health → shared browser
service → lazy panel`

Readers never trigger provider work and Cyber data stays off global bootstrap.
Browser requests for the same dataset share an in-flight request and a short cache.
Panels refresh while mounted/visible; destroying a panel clears its timers and
watchlist subscriptions. Only the first 20 matching rows render initially; **Show
20 more** expands that bounded view.

The central worker uses the existing Redis helpers and durable attempt admission
per source. Concurrent replicas share a lock and cooldown. Fetch/normalization
failure retains the last-good snapshot and its clock. Publication atomically
writes snapshot and seed metadata. The Cyber dashboard worker requires no new provider credentials. The infrastructure
collector retains its existing source credentials and entitlements; the dashboard
only projects its shared cache, without starting that collector or making GeoIP
requests. A missing or expired collector snapshot is explicitly unavailable.
CISA's official GitHub mirror is the fallback when its primary feed is unavailable.
RSS and JSON responses have time and byte limits, and links must be HTTPS.

| Source | Scheduled attempt | Delayed after | Expires after |
| --- | --- | --- | --- |
| Cyber Daily Brief | 15-minute cache check / one UTC-day snapshot | Previous UTC date | 48 hours after generation |
| FIRST / Empirical Security EPSS | 24 hours | 48 hours from retrieval or score date | 96 hours from retrieval or score date |
| CVE contributor CVSS (40 newest KEV additions) | 24 hours | 48 hours | 72 hours |
| UMD GoTech public incident sample | 6 hours | 12 hours | 48 hours |
| Shared infrastructure projection | 5 minutes | 150 minutes from collector fetch | 3 hours from collector fetch |
| CISA KEV | 1 hour | 2 hours | 48 hours |
| Each news publisher | 15 minutes | 30 minutes | 6 hours |

These states describe successful retrieval, not incident detection or internet
safety. A publisher can publish infrequently while its feed is retrieved normally.
Expired/invalid data is hidden; a failed refresh cannot reset the original fetch
clock. Missing data is never represented as zero attacks or proof of safety.
The health endpoint returns each source even when all are unavailable. Copying
infrastructure never resets its collector fetch time: the canonical envelope
clock wins over a potentially newer side metadata value. Redis retention of the
projection cannot extend its original validity. Incident fetch health is separate
from monthly publication age, which remains visible in the latest report date.

## Running the worker

`node scripts/seed-cyber-dashboard.mjs` runs once; `--loop` checks every minute
and honors each source's durable cadence. Configure Redis with the existing
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` mechanism. For repository
Compose use `compose.cyber.yaml` with `docker-compose.yml` and profile `cyber`.
Rebuild the worker image when adding these files; an app update alone cannot
populate the new cache namespace. Provider failures remain visible.

## Verification

- `node --import tsx --test tests/cyber-dashboard.test.mjs tests/cyber-watchlist.test.mts tests/cyber-dashboard-api.test.mjs`
- `VITE_BRAND=planetslam npx playwright test e2e/cyber-dashboard.spec.ts e2e/cyber-incidents.spec.ts e2e/cyber-priorities.spec.ts e2e/cyber-brief.spec.ts --project=chromium`
- `npm run typecheck`, `npm run typecheck:api`, `npm run lint:boundaries`
- Branded Vite production build, then local Compose worker/API/browser checks.

Browser acceptance uses labeled synthetic responses for filtering, safe text,
watchlist add/remove/reload, edition navigation, layout at 1440/390px, and outage
recovery. That proves UI behavior, not live provider or production operation.
Live worker-to-cache-to-API observations and the local review browser run provide
separate evidence. Publishing to Bespin is a separate authorized action.

## Catalog origin evidence

Origin describes the publisher or issuing program, not where an incident occurs.
The Hacker News identifies THN Media Private Limited as its parent on its
[about page](https://thehackernews.com/p/about-us.html); its
[registered-office notice](https://awards.thehackernews.com/contact-us/) places
that company in India. BleepingComputer's
[contact address](https://www.bleepingcomputer.com/contact/) is in New York, US.
The CVE Program's
[program FAQ](https://www.cve.org/Resources/Media/Archives/OldWebsite/about/faqs.html)
identifies MITRE as its Secretariat; the US program origin refers to that issuing
organization and sponsorship, while CVE participation is international.

## UMD GoTech source onboarding

The [official UMD project page](https://www.cpppe.umd.edu/cyber-events-database)
links the [public Cyber Events Database](https://cybereventsdatabase.org/) and
explains monthly publication and source attribution. The original reporting and
coded event date can differ; the codebook states that some event dates are
estimates. The adapter requests only the recent-record sample already presented
to anonymous site visitors, without authentication or pagination. Public access
does not establish blanket redistribution rights; the attribution ledger retains
terms-review status. Credit: Harry, C., & Gallagher, N. (2018), *Classifying Cyber
Events*, and the UMD GoTech Cyber Events Database. The issuer's origin is the
University of Maryland, US; this is unrelated to victim or actor geography.

## Phase 4: Cyber Daily Brief

The briefing covers the previous complete UTC day: from 00:00 UTC inclusive to
the following 00:00 UTC exclusive. Its generation date and time are separate
from the reporting window. Source headlines, publication dates, collection
clocks and URLs remain attached to every entry. New KEV additions refer to
CISA catalog inclusion dates, not a claim that exploitation first began then.

The central worker reads only existing validated news, KEV and incident caches.
It selects at most 15 news records and 12 KEV additions in that window, plus
three older incident research records explicitly labeled context. Tracking-URL
news duplicates use the existing aggregator policy. It captures up to 30 evidence
candidates and displays up to eight highlights (four news, three KEV, one research).
Older research by itself cannot establish a daily brief. Missing feeds and no
selected records never establish a quiet day or a global attack count.

Optional AI curation reuses `OPENROUTER_API_KEY` and the existing worker LLM
helper, pinned to OpenRouter with `CYBER_BRIEF_MODEL` (default
`deepseek/deepseek-v4-flash`). A shared Redis admission token permits one bounded
20-second/1,000-token attempt per UTC date with reasoning disabled for this
extractive selection task, across worker replicas and retries.
The model receives public evidence text and IDs, never browser watchlist terms.
It may select evidence IDs and their existing sentence/fact IDs only; new prose,
new URLs, unknown citations, duplicate items and metadata are rejected. Displayed
text is always a source excerpt. A deterministic source digest with an explicit
reason is retained when AI is unconfigured, fails, returns invalid output or has
already used the daily attempt. This is extractive AI curation, not independently
verified reporting or an AI-generated risk assessment.

A successful current-day brief remains an immutable snapshot until the next UTC
day. The worker checks every 15 minutes; no-evidence failures preserve the last
good brief and its clock. The brief becomes a previous-day snapshot on the next
UTC day and expires 48 hours after generation, independently of fetch copies.
Read-time projection ages each original feed clock and preserves dated excerpts
even after a feed snapshot expires, with that state shown in the evidence details.
The brief's fresh status means generated for this UTC date, not complete coverage
or that every original source remains live. Partial coverage remains visible for
that day's snapshot and is not silently rewritten during the day.

**Your watchlist in this briefing** matches all captured candidates locally,
including evidence not selected by AI, and shows up to five matching records.
It is bounded briefing coverage; the existing Watchlist and Attention Queue
provide broader cached views. Keyword matches do not establish installed-version
exposure. Watchlist changes update this section immediately and survive reloads
through the existing watchlist preference store. No personalized terms leave the
browser. The AI brief and its cache are shared; they contain no private inventory.

The panel uses shared, deduplicated cache reads and polls while mounted and
visible. Refresh reads the cache only, without provider or AI calls. Teardown
removes the timer and subscriptions. `compose.cyber.yaml` explicitly maps the
optional server-side OpenRouter configuration. Rebuild the worker and API image
when commissioning this phase. Existing source collection credentials and
entitlements are unchanged; no additional provider key is required.
