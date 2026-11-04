# Upstream synchronization

Keep `main` as the reviewed PlanetSlam integration branch after this foundation is approved; never rewrite upstream history or force-push shared branches. The current task stops at a draft PR.

```sh
git remote add upstream https://github.com/koala73/worldmonitor.git # once per fresh clone
git fetch upstream --tags
git switch -c sync/worldmonitor-YYYY-MM-DD origin/main
git merge --no-ff upstream/main
```

Review upstream release notes, LICENSE/notices, dependency changes, secret handling, source terms, API contracts, generated clients and authentication behavior. Resolve conflicts in isolated brand files first; preserve upstream component behavior. Never resolve a conflict by blindly copying the fork's component over upstream. Record old and new upstream SHAs in each sync PR. Do not use automatic production tracking of upstream main.

Run TypeScript, boundaries, relevant upstream tests, default-brand and PlanetSlam production builds, accessibility, desktop/tablet/mobile acceptance, storage persistence, free-seed integration and credential-canary scans. Refresh source inventory with `python3 scripts/planetslam-source-inventory.py`; compare provider/license/environment changes. Preserve unavailable and rights-gated states rather than enabling new integrations automatically.

Open a reviewed sync PR against this fork. No automatic merge/deploy. Use weekly review and urgent review for applicable security fixes. Release only a reviewed immutable revision with an exact source link and rollback artifact. Keep local brand hooks small enough to inspect at every upstream merge. A merge commit or passing local build is not evidence of deployed acceptance.
