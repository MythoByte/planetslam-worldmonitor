# Local development

Use Node **24** (`.nvmrc`) and a compatible npm (validated with npm 11). Do not copy credentials from the old PlanetSlam installation.

```sh
git clone https://github.com/MythoByte/planetslam-worldmonitor.git
cd planetslam-worldmonitor
git remote add upstream https://github.com/koala73/worldmonitor.git
git switch planetslam/foundation # draft branch until reviewed
npm ci --ignore-scripts
node scripts/generate-inventory-facts.mjs # or use upstream agent:preflight tests mode
VITE_BRAND=planetslam VITE_VARIANT=full npm run dev -- --host 127.0.0.1 --port 4480
```

Open `http://127.0.0.1:4480/dashboard`. No login or paid keys are required for the shell, globe, settings and public-feed capabilities. Many panels need upstream cache seeders and will correctly show missing/unavailable data without them. An unseeded page is not proof that feeds work. Omit `VITE_BRAND` to run default World Monitor; no source replacement is necessary. Theme preferences share upstream localStorage keys. Clear only your test origin's storage for a fresh-start check.

## Optional disposable upstream cache for live earthquakes

Docker/Compose required. Check loopback port 18079 and subnet 10.203.81.0/28 are unused; choose `PS_CACHE_SUBNET` if necessary. This is a local cache, not a web deployment. No persistent volume or cloud database is added.

```sh
umask 077
printf 'REDIS_PASSWORD=%s\nREDIS_TOKEN=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env.prototype
docker compose -f branding/compose.cache.yaml --env-file .env.prototype up -d --build
set -a
. ./.env.prototype
set +a
export UPSTASH_REDIS_REST_URL=http://127.0.0.1:18079
export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"
export UPSTASH_ALLOW_INSECURE_HTTP=true
node scripts/seed-earthquakes.mjs
VITE_BRAND=planetslam VITE_VARIANT=full npm run dev -- --host 127.0.0.1 --port 4480
# In the browser: enable the earthquake layer; verify timestamps and attribution.
```

Stop the Vite process with Ctrl-C, then remove only this disposable stack:

```sh
docker compose -f branding/compose.cache.yaml --env-file .env.prototype down
```

`.env.prototype` must remain ignored and mode 0600; never commit or print its contents. Seeded data expires. Repeat the existing earthquake seeder for refresh, not a custom polling engine. Other free sources use their existing upstream seeders after permission review. Full Docker self-hosting is documented in upstream SELF_HOSTING.md; its default Compose exposes a web listener and uses fixed container names, so do not start it on an existing installation without a separately reviewed configuration.

## Verification commands

```sh
npm run typecheck
npm run lint:boundaries
npm run security:vite-env-secrets -- --strict-local
npm run test:dom -- tests/dom/theme-preference.test.mts
node --import tsx --test tests/globe-default-map-mode.test.mts tests/variant-theme-preload-rejection.test.mts
VITE_BRAND=planetslam VITE_VARIANT=full npm run build
VITE_BRAND=planetslam VITE_VARIANT=full npx playwright test e2e/a11y-axe-scan.spec.ts e2e/planetslam-foundation.spec.ts --project=chromium --workers=1
```

Browser tests own port 4173; do not start another server there. Tests with controlled responses prove UI behavior, not provider uptime or licensing. See VALIDATION.md for actual outcomes and limits. Do not enable inherited scheduled/release workflows or attach production secrets to this fork.
