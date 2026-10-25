# TerraReady

TerraReady is a local-first, multimodal shift-planning prototype for dynamic ground conditions. It joins aerial context, inspection evidence, weather, equipment constraints, and site rules to produce an auditable **go / inspect / no-go** decision and a revised shift plan.

## The operating primitive

> Can this asset perform this task, in this place, at this time, under evidence-backed operating constraints?

| Construction | Agriculture | Mining | Forestry |
| --- | --- | --- | --- |
| Excavator × saturated work zone | Planter × wet field strip | Haul truck × rain-soft road | Harvester × protected-soil route |

The first demo focuses on construction earthworks, but the underlying planning primitive applies across physical operations.

## What the v1 demo will show

- A site superintendent reviews a post-rain shift on a visual site map.
- The system assesses machine-and-zone feasibility using explicit, deterministic rules.
- A marginal or stale-evidence condition becomes **Inspect**, never invented certainty.
- The superintendent approves a revised plan and produces role-specific updates for a field lead and haul coordinator.
- The same user flow works offline with local data. A connected Mapbox map is an optional visual enhancement.

## Current build

Phase 1 is implemented: a local FastAPI service, six typed LanceDB tables, repeatable fixtures, and a deterministic decision engine. The visual workspace, image retrieval, revised-plan approval, and teammate updates are subsequent phases.

The seed demonstrates four distinct outcomes:

| Task / asset | Route | Outcome |
| --- | --- | --- |
| East haul / loaded hauler | North access | `NO_GO` — soft road exceeds this machine's configured limits |
| East haul / loaded hauler | South access | `GO` — all route zones within demo limits |
| East excavation / tracked excavator | North access | `GO` — a different asset has different operating constraints |
| West inspection / utility vehicle | North access | `INSPECT` — stale evidence and marginal access |

These are synthetic demonstrations, not engineering recommendations. Evidence confidence describes source confidence, not the probability of safe operation. Every result still requires supervisor approval.

## Run locally

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/getting-started/installation/). From the repository root:

```sh
uv sync --frozen --extra dev
make seed
make api
```

The API listens at `http://127.0.0.1:8000`; interactive API documentation is at `http://127.0.0.1:8000/docs`. `make seed` resets the six demo tables: stop the API before reseeding. The database lives in ignored `.data/lancedb/`. `TERRAREADY_DB_DIR` can point to a different local directory.

```sh
curl -sS http://127.0.0.1:8000/api/scenarios/post-rain
curl -sS http://127.0.0.1:8000/api/scenarios/post-rain/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"east-haul","machine_id":"loaded-hauler","route_id":"north-to-east"}'
```

Switch `route_id` to `south-to-east` to compare the alternate route. An optional timezone-aware `as_of` later than the fixed scenario clock demonstrates evidence expiry.

`/health` checks process liveness; `/ready` validates the stored site snapshot. An unseeded or incomplete database returns `503` with a recovery instruction. Invalid requests return `422`, and unknown records return `404`.

## Verify

```sh
make check
uv build
```

With `make api` running in another terminal, `make smoke` verifies real HTTP responses for all three decision states against the seeded LanceDB records.

The check command runs formatting, lint, strict backend type checks and unit/API/LanceDB integration tests with branch coverage. CI runs the same checks on push and pull request, plus repeat seeding and a package build. Tests use disposable databases and do not read local credentials. The browser interaction suite will be added with the visual workspace; no UI has been verified yet.

## POC boundaries

TerraReady is not a safety-certified system, trafficability model, or machine-control product. All v1 operational layers and inspection evidence are synthetic and visibly labeled as such. The final README will include a real aerial base-map attribution and visual cross-vertical examples.

## Project documents

- [Goals and scope](docs/GOALS.md)
- [Build plan](docs/PLAN.md)
- [Current project state](docs/STATE.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Data and decision contract](docs/DATA_CONTRACT.md)
- [Research and business rationale](docs/RESEARCH.md)

## Local configuration

For the upcoming frontend, copy `.env.example` to `.env.local` and optionally set `VITE_MAPBOX_TOKEN`. Never commit this token. The backend does not load this file; Mapbox is not required for Phase 1.

## License

Code and original project assets are released under the [MIT License](LICENSE). Third-party and public-domain data are identified separately in `ATTRIBUTIONS.md` when added.
