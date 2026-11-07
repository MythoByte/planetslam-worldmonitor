# Earth phase 6 release checklist

This phase checks Earth reliability, responsive navigation, persistence and
provider recovery, and reduces the weather startup delay. Implementation and
local acceptance do not establish production deployment or provider completeness.

## Reproducible acceptance

| Path | Proof and limits |
| --- | --- |
| Fast radar metadata before map creation | DOM regression fails on the previous implementation (no source attached at style readiness) and passes after the fix. Basemap completion is independently held back. |
| Earth 2D startup scheduling | DOM tests verify the 200 ms visible-map schedule and 500 ms idle timeout, weather-only metadata prewarm, generation guards and unchanged scheduling for other editions. These budgets are not a measured end-to-end load time. |
| Real MapLibre raster loading | Browser test uses synthetic metadata and PNG tiles with real software WebGL. Radar reaches ready while one basemap tile remains pending; high map zoom requests source tiles only through zoom seven. |
| Warm reload and outage | Browser test verifies fresh persisted metadata avoids another manifest request; HTTP 503 is visible and user Retry recovers without waiting for the periodic refresh. DOM tests cover slow tiles, cache expiry, style recreation, disabled weather and destruction. |
| Globe texture | The real Earth 3D button is exercised with the renderer module held pending. Only the selected Blue Marble image starts before that module is released; normal renderer construction then reuses it. Software WebGL does not establish hardware performance. |
| Earth desktop and mobile | Existing strict Earth and My Earth suites cover hazard/news/camera browsing, selection, source outages, saved preferences, history, local alerts and responsive controls. Space and Cyber smoke tests protect edition switching. Responses are labelled fixtures. |
| Feed clocks | Producer fixtures cover quiet but freshly retrieved NWS collections, invalid/future timestamps, transport age, provider lifecycle and last-good behavior. Live retrieval is separate from these deterministic checks. |

Run focused Node/DOM suites, Earth/Space/Cyber browser suites, frontend/API type
checks, import-boundary and safe-HTML lint, docs checks, source-attribution
regeneration, the full PlanetSlam build and PWA/deployment contract suites before
delivery. Keep browser screenshots and timing JSON in the verification evidence
folder; attach inspected UI screenshots to the PR. Report baseline failures
separately instead of weakening checks.

## Release and production acceptance

- Verify the exact reviewed commit, build revision and rollback images before
  replacing the application and Earth worker. Merge and deployment are distinct
  release actions.
- Verify public Earth navigation, renderer selection, radar requests/status and
  frame time on a real desktop GPU. Check saved preferences and mobile overflow.
- Check live source health and source observation/retrieval times independently;
  a healthy container or fixture response does not establish provider freshness.
- Verify the worker captures history with its original limits and preserves
  last-good snapshots through a failed source retrieval.
- Confirm production service-worker update/recovery and source attribution.
  The build/PWA suites establish local contracts, not a public installed-client
  update.

## Explicit limits

Precipitation radar is a direct third-party integration on the 2D WebGL map.
Provider latency, rate limits and regional gaps can still delay or omit imagery.
Globe and SVG/mobile show event locations; live satellite clouds are not supplied.
The globe texture is static. Event playback does not rewind radar or camera media.
Camera availability and optional keyed feeds require separate live commissioning;
no empty feed or successfully played camera establishes an all-clear.
