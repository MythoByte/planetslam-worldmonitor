# Source-backed analysis panels

PlanetSlam restores four formerly hidden Pro panels using operator-owned sources:

| Panel | Inputs |
| --- | --- |
| Stock Analysis | Yahoo Finance price history, existing news/market context, configured OpenRouter or Ollama |
| Backtesting | Yahoo Finance price history and locally cached analysis/backtest history |
| Daily Market Brief | Existing market/news feeds, FRED context when available, configured OpenRouter or Ollama with the existing rules-based fallback |
| Deduct Situation | User question, current news context and configured OpenRouter or Ollama |

Their headers and Settings entries use ordinary names and have no Pro badge. Existing saved configurations disabled by the old premium lock are restored once. Later user disables are preserved. These panels retain each edition's scope; they do not appear by default on Earth, Space, Cyber or Happy.

## Self-hosted API configuration

Set `PLANETSLAM_LOCAL_ANALYSIS=true` in the **app service's server environment**, alongside the existing `LOCAL_API_MODE=docker` and a configured `OPENROUTER_API_KEY` or `OLLAMA_API_URL`. Keep credentials server-side. No browser API key or paid World Monitor identity is created.

Rebuild the complete application/server handlers and recreate only the app service. A frontend-only image layered over an older API image cannot enable these handlers. Preserve runtime secrets, companion containers and a rollback image/configuration.

The opt-in allows only the explicit method/path entries in `src/shared/planetslam-local-panels.ts`. Every request still requires a valid server-signed session. Cloud/hosted deployments retain their original entitlement checks. AI requests retain gateway per-IP rate and spend limits; rotating anonymous sessions does not reset the quota. Backend source/provider failures remain visible as unavailable data rather than an upgrade prompt.

## Panels that remain hidden

Latest Brief and WM Analyst require hosted account/services. AI Market Implications, WSB Ticker Scanner, Regional Intelligence, Global Procurement and Trade Policy require upstream snapshots/ingestion that are not populated in the current deployment. Their absence was checked against Bespin's cache and runtime configuration; possessing unrelated API keys does not supply these feeds. They remain hidden until their own data paths are commissioned.

Verification separates controlled browser fixtures from live provider evidence. The initial source audit confirmed Yahoo Finance historical prices were reachable on Bespin and OpenRouter was configured; fixture tests do not establish live analysis freshness or optional Finnhub/Exa enrichment.
