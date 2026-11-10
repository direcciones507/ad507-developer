# AS Developer

Independent controller recovered from `direcciones507/leveia`, branch `ad507/task-developer-runtime`, exact source `4d00cae250ed713fe6a26190a1233ff4969291d9`.

**Repository migration prepared; Railway cutover BLOCKED.** The existing service is unchanged. Docker image build/restart, real executor isolation, controller-to-executor connectivity and a consistent private persistent-volume backup remain required. DeepSeek stays disabled.

## Run locally without paid calls

Node 24+ and Git are required. The controller has no production npm dependencies.

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
```

Generate the owner hash privately with `node runtime/hash-password.mjs`; configure the required HTTPS origin and hash through the deployment environment. `npm start` serves the standalone panel. There is no default password. Use `AD507_PROVIDER=simulation` for controlled synthetic tests; production DeepSeek must retain `AD507_LIVE_ENABLED=false` until owner authorization.

## Structure

- `runtime/`: server, private panel, durable SQLite queue, per-project source cache, workspace and publisher, DeepSeek adapter and tests.
- `src/`: retained task classification, security and coordinator policy, CLI.
- `config/projects.json`: seed registry; persisted operator additions remain authoritative.
- `Dockerfile`, `railway.toml`, `deploy/`: standalone build and operations.
- `docs/SOURCE-HISTORY.json`: exact source corrections and patches; unrelated private LeveIA history is excluded.
- `docs/legacy/`: unchanged historical documentation, **not current deployment instructions**.

## Projects and persistence

The seeds retain Mi Contacto (`recovery/mi-contacto-existing-20261101`), Direcciones507/LATAM, Empleos.pa, ReportaPA, LeveIA and historical Junta preparation. Additional projects, including a registered Junta website, load from the existing SQLite registry. The owner selects the project for each task. Use repository-specific token variables in Railway; never put credentials in this repository.

Keep the same service, domain, volume `/data` and `AD507_DATA_DIR=/data/ad507`. Tasks, events, reservations, sessions, custom project records, runner keys, caches and workspaces are not replaced or reset. No live database or secret was downloaded into this repository.

## Controlled checks

GitHub Actions is disabled in the standalone configuration, and the operational entrypoint never loads its dispatcher. A bounded `.github/workflows/safe-ci.yml` validates this public repository only; it is not the agent's execution backend. Historical Actions modules/tests remain for traceability and offline protocol regression; they are not an operational backend.

`local-docker` requires a dedicated Docker-capable execution environment with reviewed images. The Railway controller image deliberately has no Docker daemon or socket. **The existing Railway service alone cannot currently execute these code checks. No remote Docker worker is provisioned or connected by this migration.** Never attach a privileged host socket to this web controller as a workaround. A separate authenticated executor integration and real boundary validation remain open; no host-shell fallback exists.

On a reviewed executor host, build `deploy/checks.Dockerfile`; tests run without network, secrets, capabilities or writable source, as UID 1000 with CPU/memory/PID/time limits. The basic image supports syntax and dependency-free Node tests; projects with dependencies require separately reviewed, prebuilt images. A syntax check does not prove behavior or a build.

Only allowlisted commands can run. Every changed revision still requires a passing check before delivery. Read-only diagnostics cannot mutate files or dispatch checks. Missing executor availability stops live editing before the first model reservation. Repeated reads reuse prior evidence, and repeated searches terminate before another paid turn. Task, project and global spending caps remain transactional and persistent.

See [migration and rollback](docs/MIGRATION-20261101.md) for the blocked release gates and exact service identifiers.
