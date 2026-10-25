# Running, troubleshooting and reproduction

Reference for the current local single-host demo. The root README remains the default quickstart. Stop services with Ctrl-C in their terminals; preserve existing database/history before deliberate reset or migration.

## Dependencies and services

Requires Python 3.12, Node 24 LTS (or 22.13+), npm and uv. Clean locked installs were verified with uv 0.13.5. Dependency/browser/model setup needs network access; the default bundled aerial and manual workflow do not.

| Service | Command | Address |
| --- | --- | --- |
| API | `make api` | `http://127.0.0.1:8000` |
| Web | `make web` | `http://localhost:5173` |
| Optional model | `make model` after [explicit setup](LOCAL_AGENT.md) | Authenticated loopback 8080 |
| Interactive API docs | Open while API runs | `http://127.0.0.1:8000/docs` |

These are local development services. The current app has no public authentication or multiuser isolation. Do not expose its unauthenticated API/model as a hosted demo.

## Database lifecycle

`make seed` explicitly layers `data/fixtures/shift-docket.json` onto the original ground fixture and replaces the six fixture tables. Run it before first startup in a fresh checkout, or deliberately with the API stopped after preserving needed history. There is no automatic startup migration/reset.

The approval and assistant-audit tables are created on first use. Their history survives reseeding, but an approval applies only to the matching snapshot, clock, planning policy and selection. Approval does not mark work complete or satisfy prerequisites.

The shift editor keeps checked choice IDs and their source identity in browser session storage for reload. LanceDB remains authoritative for approvals; the API revalidates restored choices. If browser storage is blocked, checking/approval still work, but that browser cannot automatically restore its custom selection. Unchecked edits do not replace the saved checked choices.

The default database is ignored `.data/lancedb/`; `TERRAREADY_DB_DIR` selects another local directory. Run one API process per database. Concurrent reseeding, multiple writers and shared multiuser hosting are outside this verified local contract. Legacy v1 records can serve the original workspace; recovery requires the explicit v2 docket.

## API examples

With a seeded local API:

```sh
curl -sS http://127.0.0.1:8000/api/scenarios/post-rain
curl -sS http://127.0.0.1:8000/api/scenarios/post-rain/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"east-haul","machine_id":"loaded-hauler","route_id":"north-to-east"}'
```

Change the route to `south-to-east` to compare the alternate. A timezone-aware `as_of` later than the fixed scenario clock demonstrates expiry; it does not ingest new field conditions.

`GET /api/scenarios/post-rain/recovery` returns the seven-package proposal. `/recovery/evaluate` validates an explicit candidate selection, and `/recovery/approvals` saves its fingerprint-bound local approval. The original `/plan` and `/approvals` cover three originally scheduled packages with a distinct selection policy/approval contract. Do not merge their scopes.

`/health` checks process liveness; `/ready` validates stored site data. Missing/incomplete data returns 503; invalid requests return 422 and unknown records 404. A 503 is a reason to inspect setup, not permission to reset an existing database automatically.

## Optional imagery and cameras

The local aerial is the default. Satellite mode opts into Mapbox; missing token, network or WebGL support falls back to the bundled aerial. Both use the same synthetic zones and decision engine. Mapbox imagery is not bundled.

Vite reads optional `VITE_MAPBOX_TOKEN` from repository-root `.env.local`; the backend does not load it. Use a dedicated public token restricted to the intended development origins. Public client tokens are browser-visible by design. Never commit local environment files or publish build output without reviewing restrictions. No token is needed for default setup/tests.

The default camera source is a disconnected stub. [CAMERAS](CAMERAS.md) documents the read-only provider/folder interface, capture bounds and the distinction between snapshots and trusted numerical measurements. No device credentials belong in public metadata.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Site data unavailable | Fresh checkout: seed before starting the API. Existing checkout: inspect configuration, stop API and preserve history before any deliberate reseed. |
| Model unavailable | Expected without optional setup. Manual planning remains available. Follow LOCAL_AGENT, verify pinned assets, then start the model separately. |
| Satellite fails | Select Local aerial; no Mapbox account is required. |
| Approval changes with evidence clock | Review the newly checked proposal. An old fingerprint cannot approve changed/expired evidence. |
| Port is occupied | Identify the owning process and use another isolated test session; do not kill unrelated services. |
| Clipboard unavailable | Select/copy the displayed brief, or use the route-review download. Copying/exporting never sends it. |

## Verification and reproduction

Install locked dependencies (`uv sync --frozen --extra dev --python 3.12`, `npm ci`) before these checks. For browser QA, install full Chromium:

```sh
PLAYWRIGHT_BROWSERS_PATH=.data/pw-browsers npx playwright install chromium
make verify
uv build
```

`make verify` runs backend formatting/lint/strict types/tests, frontend formatting/types/lint/build and browser QA. Browser services reserve 5174/8001/8082 with disposable `.data/e2e-lancedb`; stop conflicting test previews first. Tests block external requests, use a fake Mapbox token and label the model-protocol stub. They are not a real-inference benchmark. Failure traces/screenshots/videos remain local; GitHub CI retains uploaded failures for seven days. Screenshot baseline changes require inspection, not relaxed tolerance.

With the API running separately, `make smoke` checks real HTTP ground/recovery responses. `make agent-smoke` explicitly runs genuine inference after model setup. `uv build` creates backend source/wheel distributions, not a full web installer.

Historical clean-checkout proof on 2026-10-25 used macOS arm64, Python 3.12.12, uv 0.13.5 and Node 24.22.1, with fresh Python/npm/browser downloads and no copied credentials/database/model/build. Application `a6c39d4` passed 268 backend and 44 browser tests; source-package/attribution/manual-demo checks used `82feb5a`. Repeat seeding, real HTTP smoke and real-API/no-model browser fallback/approval/clipboard/reload/expiry/mobile passed. Two source exports were identical and package members were reviewed.

That proof predates the camera extension. Published `816a4eb` passed remote GitHub CI with 296 backend and 49 browser tests, including current camera contracts. The real GPU test used `45ff57e` and has its own [typed artifact](verification/gpu-agent.json). Current source, historical regression results and hardware evidence are separate claims. Full-stack enforced outbound denial, Jetson/power and production reliability are unverified.
