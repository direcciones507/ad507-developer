# Migration record — 1 November 2026, Panama

## Verified source and scope

Source: `direcciones507/leveia@ad507/task-developer-runtime`, head `4d00cae250ed713fe6a26190a1233ff4969291d9`. The five requested corrections `6001263`, `0e97a6a`, `107d8df`, `c40cdf7`, `4d00cae` were read and their agent-only patches retained in `SOURCE-HISTORY.json`. Snapshot import preserves their resulting code; unrelated LeveIA Git history is not exported. Original source-file hashes and the moved-path mapping are recorded in `SOURCE-MANIFEST.json`.

Only AD507 code and documentation were copied. The source repository was read only; its branches, visibility, files and services were not changed. It was verified private. The destination was already created and empty; its existing public visibility was not changed.

## Changes

Standalone root package, lockfile, Dockerfile, config registry and Railway config replace monorepo build paths. The controller needs no npm production dependency; Node 24 executes its retained TS policies. CLI project selection is explicit. Operator-added project rows remain authoritative across restart; the known Mi Contacto recovery-branch correction is retained.

GitHub Actions backend selection fails closed; main no longer instantiates or reconciles an Actions dispatcher. No workflows are shipped. Historical source modules and offline protocol tests remain for traceability. Existing deployment variables must be reviewed before cutover: change `AD507_CHECK_BACKEND` to a reviewed isolated backend and `RAILWAY_DOCKERFILE_PATH` to `Dockerfile`, retaining `AD507_LIVE_ENABLED=false`.

Read-only mutation protection, repeated-read suppression, project mismatch rejection, accurate no-match inventory and executor preflight were added. Security gates and budget accounting were not relaxed. Read-only tasks can finish without a sandbox; changed code cannot bypass checks. Basic allowlisted project tests run only in a container, not on the controller host.

## Validation

- Original runtime suite: **45 passed / 3 failed**. Two assertions assumed five seed projects rather than six. One test exposed the inventory total being replaced by the filtered result count. Those issues were corrected without deleting tests.
- Independent runtime + policy + migration regression suite: **73 passed / 0 failed / 0 skipped**.
- TypeScript: passed with the standalone package and lockfile.
- JS/JSON syntax: passed; the log identifies the number of supported files. This is not a build test.
- Existing real-process tests verify authenticated API, SQLite/task/session persistence, SIGKILL recovery, cross-project isolation, approval gates, budgets and interrupted tool batches, using synthetic data and mocked provider/HTTP integrations.
- Docker controller image restart: **BLOCKED**, `spawn docker ENOENT`.
- Real isolated executor: **BLOCKED**, `SANDBOX_NOT_AVAILABLE`; Docker/Podman absent. Contract/security-flag tests pass with a stub executor but do not replace a real container boundary test.
- Browser visual check: **BLOCKED**, Playwright Chromium executable is absent. No visual verification is claimed.
- No paid DeepSeek calls, real provider tests, Actions, PRs or product deployments were performed.

## Railway before and after

Project `leveia-staging`: `1b44bc7e-db12-4ea6-9955-70c4ce68aed3`.
Environment `production`: `b8391221-bfd2-41eb-a4fa-c3f10dea8044`.
Service `ad507-developer`: `419d5122-4e9c-42f9-9b27-3a6bfaee2ae5`.
Domain: `ad507-developer-production.up.railway.app`, port 8787, health `/health`.
Volume `ad507-developer-data`: `ff3de8a0-a8b7-4c90-86d3-722270139397`, mounted `/data`, 1000 MB.
Observed deployment `f81d19fb-ddae-43f8-8eab-d3bef1576d3b`: SUCCESS.
Its startup log at `2026-11-02T01:20:12Z` (1 November in Panama) confirms `provider=deepseek; live=false`.

**No source, config, variable, volume, domain or running deployment was changed.** The source remains `direcciones507/leveia@ad507/task-developer-runtime`. Variables were inspected by name only; secret values were withheld. The other LeveIA web/API deployment IDs were recorded and preserved.

## Release gates and controlled cutover

1. Build the controller image from this repository root on a Docker-capable host. Run `npm run test:controller` against a new disposable volume, proving non-root startup, persistent tasks/sessions/workspaces and restart recovery. Do not use the live volume for this test.
2. Provision/connect an authenticated isolated execution host and validate actual Docker isolation and all required project dependency images. The existing Railway controller cannot currently reach a configured dedicated executor; **that integration is not delivered as operational**. Do not substitute host execution or GitHub Actions.
3. Quiesce the worker with inference disabled; privately back up the full persistent volume consistently, including SQLite WAL state, sessions, project registry, runner keys and workspaces. Verify restore in a private disposable environment. No private backup belongs in GitHub.
4. Recheck the exact reviewed destination commit and runtime suite. Change only the existing agent service to `direcciones507/ad507-developer@main` pinned to that reviewed commit; use root `/`, `Dockerfile` and `railway.toml`. Preserve its ID, domain, volume mount and all unrelated variables. Keep DeepSeek disabled.
5. Verify `/health`, owner login, project selector, persisted tasks/reservations and simulated jobs without paid calls. Compare volume ID/mount and the untouched LeveIA web/API service deployments.
6. Reactivation of paid inference requires separate owner authorization. Do not infer it from permission to migrate.

These gates are not met, so **cutover was stopped**. This is a code delivery, not a completed operational migration.

## Rollback

Current rollback target: original service source `direcciones507/leveia`, branch `ad507/task-developer-runtime`, exact commit `4d00cae250ed713fe6a26190a1233ff4969291d9`; successful deployment `f81d19fb-ddae-43f8-8eab-d3bef1576d3b`.

If a future cutover fails, keep inference disabled and restore only this service's source/build settings from `deploy/railway-plan.json` (`tools/ad507-agent/Dockerfile`, original root and original reviewed variable configuration). Redeploy the known-good commit on the **same** service and **same** volume. No schema-destructive migration is introduced here. Do not reset SQLite, overwrite the registry with seeds, recreate the volume, or replay interrupted tasks automatically. Verify health/login and persisted records before any owner-authorized inference.
