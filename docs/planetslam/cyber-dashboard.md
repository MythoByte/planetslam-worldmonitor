# PlanetSlam Cyber dashboard — Phases 1–7

Open `/dashboard?variant=cyber` or choose **Cyber** in the PlanetSlam edition
switcher. The edition uses the shared layout/settings/theme and movable,
resizable panels. New profiles enable the Cyber map. Existing saved map choices
are preserved; **Show Cyber map** or an incident's **Locate on map** explicitly
enables and reveals it. Global attack statistics and automatic installed-version discovery are not provided; Phase 7 uses declared inventory.

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
is required. Bulk NVD ingestion and asset discovery remain later work.

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

## Phase 5: Cyber Alerts & Digests

Monitoring is opt-in and off by default. Enable it in **Cyber Alerts & Digests**.
It runs while that panel is enabled/mounted and the Cyber edition is open,
including background tabs subject to browser timer throttling. It is not a
closed-browser push subscription, email service or Telegram integration.
No notification destination, provider key, account or billing change is required.
Rules, baselines, alert history and watchlist matches stay in this browser under
`planetslam-cyber-alerts-v1`; personalized data is never sent to the server.

The controller reads existing cache-only endpoints roughly once a minute and
on return to a visible tab. Checks are shared with the existing Cyber service
cache; they never start provider collection or AI calls. First usable reads
establish independent baselines without announcing existing records as new.
Enabling monitoring or changing matching rules/watchlist terms establishes new
baselines. Disabling monitoring retains history and stops browser delivery.
Reloads retain baselines, rules and duplicate suppression. Paused or closed pages
cannot promise observation of every upstream change; reopening compares currently
available cached records to saved baselines.

- **Watchlist vulnerabilities:** new qualifying KEV records or records becoming
  qualified use literal vendor/product/title matches. Optional EPSS thresholds
  (10/50/90%) and CVSS thresholds (High/Critical) both require known fresh scores.
  Missing whole threshold feeds preserve the previous baseline. Unknown individual
  scores do not satisfy a selected threshold; unknown remains allowed when that
  threshold is disabled. CVSS still covers only 40 newest KEV additions. Alerts
  indicate keyword relevance and known exploitation, not installed-version exposure.
- **Incident research updates:** detect new observed records and meaningful changes
  to organization, category, country, description, verification, event/report date,
  original reporting or change log. Retrieval/revision timestamp changes alone do
  not alert. Choose all reported records or watchlist keyword matches, with a
  7/30/90-day report-age window. Monthly research cadence and claim uncertainty
  remain explicit; an alert is not live attack detection.
- **Source outages and recovery:** require 2/3/5 consecutive observed quality
  transitions, covering delayed, unavailable and recovered states. The first
  source observation is a baseline, including existing outages shown in status.
  A network read failure retains baselines and reports incomplete monitoring;
  it is not mislabeled as a provider outage. Manual checks count as observations.

The inbox supports Mark all read and Clear inbox. Clearing retains baselines
and duplicate suppression. Display/retention is bounded to 200 events / 30 days,
with at most 1,000 dedupe entries, 10,000 KEV baselines and 1,000 research baselines.
The daily digest summarizes bounded retained alerts since its previous cutoff.
Choose a UTC hour; the first deadline is the next occurrence after enabling.
If a deadline was missed, the next running check catches up once, not once for
every missed day. Changing schedules cannot send a second digest on the same UTC
day. Zero retained alerts is explicitly not evidence of safety or complete coverage.

Browser notifications require an explicit **Enable browser notifications** click
and granted browser permission in a supported secure context. Cooperating tabs
serialize state and delivery through Web Locks. Without that coordination support,
the inbox still works and browser delivery stays disabled. In-app cross-tab
coordination is best effort on browsers without Web Locks. Mobile delivery uses
an active service worker when available; desktop construction is the fallback.
The existing service-worker click handler opens the local Cyber dashboard.
Notification bodies are generic, tags are opaque, and watchlist/source details
stay in the inbox. Choose realtime (up to three notifications per check) or daily
digest-only delivery. Extra events remain in the inbox; they are not replayed in
a later notification burst. Permission grant never replays old history. An async
permission response cannot re-enable delivery after disabling/leaving the panel.

Rules, baselines and event/digest claims are committed to one local storage record
before any browser delivery. Failed reads never mean an empty profile. Writes
are read back to verify persistence; unreadable, full or silently dropping storage
pauses monitoring and sends no browser notification. Retry browser storage preserves
history; corrupt state requires explicit Reset local alert data. Failed or uncertain
notification delivery leaves the inbox intact and is not automatically replayed.
A permission denial affects browser delivery, not inbox monitoring. Mounting the
panel never requests permission. Teardown removes polling and event subscriptions;
in-flight work checks its lifecycle revision before committing or notifying.

Verification includes pure threshold/baseline/revision/UTC-schedule contracts,
controlled desktop/mobile browser permission and two-tab tests, storage failures,
service-worker delivery payloads, uncertain-delivery suppression and Phases 1–4
regressions. Browser permission/platform support varies; these tests do not prove
that every operating system displays notifications while the browser is suspended.

## Phase 6: observed history, trends and investigations

**Cyber Research Workbench** accumulates public incident records observed by this
browser while the panel is enabled and open. It reads the same cache-only incident
and news endpoints; no new keys, backend writes, AI calls or provider collection
are introduced. It does not unlock historical provider downloads, backfill a global
incident database, or turn the current 20-record monthly research sample into
representative attack statistics. New profiles start without historical observations.

Only fresh, unexpired, validated incident snapshots enter the local archive.
Unavailable, stale, invalid and older provider snapshots cannot replace it. Records
missing from a later sample remain available. Each source ID counts once, using its
latest captured classification. The archive retains at most 200 records and removes
records 180 days after their last local observation. Provider fetch, event and report
dates remain separate from first/last browser observations. A first local observation
is not a newly occurring incident. Source claims remain reported or claim-in-reporting,
not independently verified.

Country, sector, report-age and literal-search filters apply only to the workbench.
They do not change the live tracker or map. Counts and bar charts describe filtered,
retained sample records, including unknown countries and sectors. Weekly groups use
UTC Monday-start weeks of provider report publication, not capture dates. The latest
12 represented weeks are shown; missing weeks are omitted, not asserted to have zero
incidents. Country and sector charts show the six largest represented groups with
explicit truncation. No sample count is presented as a global rate or complete total.
The first 20 newest reports are displayed; **Show more observed records** reveals
older matching records. CSV always includes all filtered retained records.

Meaningful source changes retain up to five changed-field observations per record.
These identify changes to organization, country, sector, category, description,
event/report dates, claim label, source links and provider change log. Retrieval and
provider revision timestamps alone do not create changes. This is an observation
log, not storage of every full historical version or edits that happened offline.

**Save investigation** freezes a source snapshot and available related links.
Up to 30 investigations can have a title and 4,000-character private notes. Use
**Save notes** explicitly. Exports contain saved values, not unsaved edits.
Feed changes, archive eviction and clearing observed history never rewrite or delete
saved evidence. A local investigation may therefore differ from the current record.
Saved cases retain their provider and local-observation dates and source claim labels.
The same incident cannot be pinned twice; notes can be edited in its existing case.
Deleting a saved investigation removes that case from this browser.

Related reporting consists of at most five usable HTTPS news links from the seven-day
cache whose title or summary contains the literal organization name with word
boundaries. Generic/short organization names are excluded, and tracking variants of
the same URL are deduplicated. It is labeled **keyword-related reporting**, not proof
of the same incident, campaign or attribution. These links are frozen at save time
with the news provider fetch date. No matches does not establish absent reporting.

**Export filtered sample CSV** includes coverage, source links, claim labels, provider
and observation dates, and descriptions. It excludes private notes. Spreadsheet cells
are quoted, embedded separators/newlines are preserved and dangerous formula prefixes
are neutralized. **Export saved investigation JSON** includes the saved case, notes,
source evidence, related links, export time and coverage caveats. Exports download
locally; there is no cloud upload or email delivery. Choose a destination with the
knowledge that investigation JSON contains private notes.

Research stays in `planetslam-cyber-research-v1` on this origin/device, with a bounded
validated storage record. Read failures and corrupt profiles are not empty archives;
saved data is preserved until explicit **Reset all research data**. Writes are checked
and read back before reporting success. Failed writes retain the last readable saved
state; **Retry research storage** retries that state. Cooperating tabs serialize writes
using Web Locks where available; browsers without Web Locks have best-effort
coordination. Conflicting note saves are rejected without discarding the unsaved draft;
**Reload saved notes** loads the current saved version. Storage is local, not encrypted
or account-synchronized, and clearing browser data removes it.

**Pause capture** preserves history and investigations. **Clear observed history and
pause** clears only observations and stops immediate recapture; saved cases remain.
**Resume capture** admits the next usable current snapshot. Resetting all research
also removes investigations and notes. Teardown stops refreshes and storage listeners.

## Phase 7: My Environment

**My Environment** is a browser-local workspace for declared software inventory,
OSV version-query evidence and private remediation tasks. It performs no host,
network, container or filesystem discovery. Inventory does not establish that the
software is actually deployed, reachable or exploitable. No additional API key,
backend inventory database, AI call, account or provider seeder is introduced.
Phase 7 is implemented for review; merge/publication follow separate authorization.

### Local imports and identity review

Add a package manually or choose **Inventory JSON file**. The asset/environment
label is local context. Supported JSON inputs are CycloneDX 1.4–1.7 components,
SPDX 2.2/2.3 packages, and this minimal inventory format:

```json
{
  "format": "planetslam-inventory",
  "version": 1,
  "packages": [{"name": "lodash", "version": "4.17.19", "ecosystem": "npm"}]
}
```

Files are bounded to 5 MiB and 2,000 traversed component nodes, with at most 500
unique normalized inventory rows. Parsing is local; raw SBOM metadata, properties,
supplier information and file contents are not stored or uploaded. A preview
shows duplicates, missing versions and unresolved identities before confirmation.
Default import mode replaces the selected asset's inventory; users can explicitly
choose to add entries instead. Other assets and saved remediation tasks remain.
Unchanged asset/package/version identities keep stable IDs. Bad documents and
oversized combined inventories are rejected without a partial import.

PURLs identify supported public registries: npm, PyPI, Go, Maven, crates.io,
RubyGems, NuGet and Packagist. Registry case/normalization rules are preserved;
Maven identities include group and artifact. Unknown PURL types, private registry
qualifiers, conflicting declared/PURL names or versions, missing versions and
unsupported version identifiers cannot be queried automatically. Distro packages,
CPE-only/vendor products, version ranges and moving tags remain unknown. Resolve
identities explicitly with **Edit declaration**. A name resemblance to a CISA
product is not treated as version applicability.

See the [CycloneDX JSON reference](https://cyclonedx.org/docs/1.6/json/) and
[SPDX package information](https://spdx.github.io/spdx-spec/v2.3.1/package-information/)
for the source formats. This is a bounded extraction of identity fields, not a
complete SBOM graph, licence or provenance validator.

### Explicit external version queries

Importing, opening the panel, showing a saved finding, reloading the page or
editing inventory never initiates an OSV lookup. **Review this package lookup**
or **Review lookups for filtered inventory** shows the exact outbound JSON first.
The plan deduplicates identical registry/name/version identities across assets
and admits at most 25 distinct package versions per run. It is not silently
expanded if inventory changes.

Only **Send N package versions to OSV** sends the reviewed registry ecosystem,
package name and version directly to the public OSV query API. The request omits
cookies and referrer data. Asset labels, raw SBOM, remediation owners and notes
are excluded. OSV sees the selected software identities/versions and the user's
network address. There is no server proxy or automatic background lookup.

OSV applies its ecosystem version semantics and upstream normalization; the UI
labels evidence as an OSV version-query result. It does not implement a universal
local version comparator or infer applicability from keywords. Read the
[official OSV query contract](https://google.github.io/osv.dev/post-v1-query/).
Results retain record links, aliases, provider modification dates and individual
observation times. Fixed-version markers apply only to the matching package's
SEMVER/ECOSYSTEM ranges; they are provider guidance, not automatic upgrade commands.
Withdrawn records are omitted. Other-package results and malformed data fail closed.

Queries are serial, with at most five pages, 20 seconds per request, 2 MiB per page
and 50 advisory entries per package lookup. Missing/failed pages, oversized data
and repeated continuation tokens remain partial/failed coverage. A successful
empty result means only that OSV returned no advisories for that declaration;
it is never an all-clear. Failed/incomplete refreshes retain previous evidence
with its original per-advisory observation times, prioritizing newly observed
entries within the retained budget. No stale evidence is renewed as a fresh match.
Older-than-seven-day lookups are visibly marked for explicit rechecking.

**Cancel remaining OSV lookups**, hiding/closing the panel, changing inventory or
leaving the dashboard cancels pending work and invalidates late responses. Already
sent disclosures cannot be retracted. There is no automatic retry or closed-browser
service. At most 100 lookup snapshots and 500 advisory entries are kept per profile;
storage-limit failures preserve the last readable saved state.

Current fresh KEV context is joined only by exact advisory/CVE aliases, retaining
CISA's evidence of exploitation and required action. No KEV link does not establish
absent exploitation; stale/unavailable KEV context remains unknown. Federal due
requirements and actual local exposure are not inferred from a link.

### Private remediation workflow and exports

**Add to remediation list** freezes the package/version, asset context, advisory
and its observation date. Track open, in-progress, resolved or accepted, with an
owner, due date and up to 4,000 characters of notes. These are manual workflow
states, not a check that patches were deployed. At most 200 tasks are retained.
Inventory edits/removal do not automatically close tasks or rewrite their evidence;
changed context/version is labeled for review. An old version's lookup is not
reused for a new version. Tasks can be deleted explicitly.

**Save remediation** commits edits. **Reload saved remediation** restores the
actual form values, including when the panel's HTML cache is unchanged. Conflicting
cross-tab saves reject the overwrite and preserve the draft for review. Storage is
serialized through Web Locks where supported; otherwise coordination is best effort.

**Export private environment JSON** includes saved inventory, lookup snapshots,
remediation notes and coverage. **Export private remediation CSV** also contains
private asset labels, owners and notes, with CSV quoting and formula-prefix
neutralization. These are local downloads, not cloud uploads; unsaved edits are
excluded. Export files are archives, not an automatic workspace-restore format.

Data lives under `planetslam-cyber-environment-v1` on this browser/origin, without
account synchronization or encryption. Failed reads are not an empty inventory;
malformed data requires explicit reset. Writes are validated and read back before
success. **Clear inventory and lookups; keep tasks** retains task snapshots and
notes. **Reset all environment data and notes** explicitly deletes all workspace
content. Clearing browser data also removes it.
