# Current project state

**Updated:** 2026-10-24

## Completed

- Created the `terraready` workspace and initialized a Git repository.
- Added local Mapbox configuration hygiene: `.env.local` is ignored and `.env.example` is tracked.
- Recorded approved v1 scope, product boundaries, architecture decisions, research rationale, and phase plan.
- Configured a local Mapbox token outside version control.
- Committed the Phase 0 foundation (`docs: establish TerraReady project foundation`).
- Completed Phase 1: Pydantic data contract, six typed local LanceDB tables, repeatable seed, pure decision engine, FastAPI endpoints and locked dependencies.
- Added `make seed`, `make api`, `make check`, and `make smoke`, with backend CI for checks, repeat seeding, live HTTP smoke tests and package builds.
- Added `docs/DATA_CONTRACT.md` with units, explicit demo rules, evidence precedence, clock semantics and expected business outcomes.

## Evidence

- Phase 0 documentation exists.
- `.env.local` exists locally and is ignored by Git.
- `git diff --check` passed on 2026-10-24.
- `git check-ignore -q .env.local` passed on 2026-10-24.
- `make check`: 73 tests passed, 99.49% statement/branch coverage overall; 100% engine statement/branch coverage. Formatting, lint and strict backend typing passed with no warnings.
- `make seed`: 1 scenario, 5 zones, 3 machines, 3 routes, 3 tasks and 5 observations stored in `.data/lancedb/`; repeat-seed behavior verified against a real disposable LanceDB database.
- `make smoke` against live Uvicorn on `127.0.0.1:8000`: north hauler route `NO_GO`, south route `GO`, expired evidence `INSPECT`, all approval-gated. Verified through HTTP, beyond the in-process API tests.
- Frozen offline dependency sync passed. Source and wheel builds passed; distribution file listings contain no `.env.local`, generated database or dependency cache.
- CI workflow is configured but has not run on GitHub: no remote repository has been created or pushed.

## Decisions in force

- Construction earthworks is the v1 vertical; the README must make cross-vertical reuse explicit.
- Real public-domain aerial imagery will be combined with clearly marked synthetic operating layers.
- Mapbox is optional; the final demo requires an offline fallback.
- Go / inspect / no-go and revised-plan decisions are deterministic and approval-gated.
- The fixed demo clock is 2026-10-24 07:00 America/Los_Angeles. Later evaluation clocks demonstrate evidence expiry; earlier clocks are rejected.
- The engine evaluates every route zone and the destination. Static closures/capability limits block operation; fresh conflicting observations require inspection. Source confidence is not a safety probability.

## Risks / unresolved work

- Select a suitable NAIP crop and record provenance before adding it; local-meter fixture geometry must be aligned to that chosen scene for Phase 2.
- There is no visual workspace, image retrieval, browser QA, revised-plan approval or teammate communications yet. These remain later phases, not verified features.
- Seed replacement is not a cross-table transaction; run it with the API stopped. Stored data is validated before evaluation; broken or unseeded snapshots yield a recovery-oriented `503`.
- The API is local-only and unauthenticated. Run on loopback as documented; public hosting is a separate decision.
- The root `.env.local` was not read or exposed. Configure the future Vite app's environment directory so it can consume the root variable without relocating or printing the token.

## Next step

Phase 2: select and attribute a real aerial crop, align the site geometry, then build the map workspace and evidence panels against the existing `/api/scenarios/post-rain` and evaluation endpoints. Add Playwright interaction and offline-fallback checks with that UI slice. Follow `docs/PLAN.md`; do not claim browser verification until the actual UI has been exercised.
