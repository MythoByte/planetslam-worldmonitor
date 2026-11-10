# GDELT reported air attacks

PlanetSlam's **Reported Air Attacks** layer reads GDELT's public 15-minute event exports. It selects primary material-conflict records coded as CAMEO 195 (aerial weapons use), worldwide. This includes aerial attacks that may involve missiles or drones; the feed does not reliably identify those weapon subtypes. Reports are not independently confirmed, and multiple reports can describe the same incident.

Each marker uses the record's ActionGeo coordinates and labels their country, region or place precision. These are estimated event areas, not verified impact sites. Actor locations and publisher countries are never substituted for event coordinates. Selecting a marker opens its original source link, publisher, event date and GDELT indexing timestamp. GDELT supplies only a day for the event date; the indexing timestamp is not an attack time.

The relay polls once every 15 minutes, retains a bounded rolling 24-hour reporting window in Redis and serves a cached snapshot through `/api/attack-reports`. No provider key is needed. The World preset enables the layer; its desktop toggle persists, and mobile uses the preset's fixed layers. SVG, DeckGL and globe renderers support the markers.

Responses cap at 500 reports and deduplicate the same article, approximate action area and event day. The initial window is partial, missed exports may leave gaps, and no completeness claim is made. Records with missing coordinates, invalid dates or unsafe source URLs are rejected. Successful empty results, stale cached data and unavailable feeds have distinct labels. Source freshness expires after 45 minutes; reports expire after 24 hours of GDELT indexing age.

Deploy the app/API and repository `Dockerfile.relay` together. The relay image includes the parser and existing verified GDELT download helpers. `gdeltAttackReports` is monitored as a standalone health key with `seed-meta:gdelt:attack-reports`; it does not expand the bootstrap payload or reuse the separate Middle East strike feed.

Validation:

- `node --test tests/gdelt-attack-reports.test.mjs tests/conflict-gdelt-bulk.test.mjs tests/attack-reports-api.test.mjs tests/dockerfile-relay-imports.test.mjs`
- `VITE_BRAND=planetslam npx playwright test e2e/planetslam-attack-reports.spec.ts --project=chromium`

The browser checks use synthetic reports and a controlled WebGL basemap. A live ingestion smoke check separately exercises GDELT's current public exports. Neither test establishes complete coverage or confirms an attack.

Reference: [GDELT 2.0 event data codebook](https://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf).
