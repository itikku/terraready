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
- Completed Phase 2: React/TypeScript/Vite visual workspace, local aerial with selectable georeferenced work zones and route overlays, machine selection, evidence panels, clock expiry, image/provenance dialogs and optional connected Mapbox mode.
- Added a machine-readiness API that reuses the decision engine and persisted local image references/captions in LanceDB.
- Bundled a public-domain NAIP crop and an explicitly synthetic inspection illustration. Sources, dates, checksums and the exact generation prompt are in `ATTRIBUTIONS.md`.
- Added browser CI, a reviewed screenshot baseline and desktop/mobile README images. All external requests are blocked in the core browser suite.
- Phase 3 backend slice: pure deterministic route planner, evidence-review deadline, snapshot fingerprint, approval API and typed idempotent local LanceDB approval records with both teammate briefs.

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
- Phase 2 `make check`: 76 passed; 99.52% overall statement/branch coverage and 100% engine coverage. Backend formatting, lint and strict typing passed.
- Phase 2 `make web-check`: frontend formatting, types, lint and production build passed. The optional lazy-loaded Mapbox chunk produces a bundle-size advisory; it is not loaded for the default local map.
- `npm run test:e2e`: 14 passed, including actual screenshot comparison (not an update run), zero axe accessibility violations, machine/route changes, stale evidence, provider failure, keyboard use, dialogs, loading/API/image recovery and 390px mobile layout.
- Visually inspected desktop and mobile screenshots; repaired initial text-contrast failures and a mobile map-badge layout defect. Reviewed baseline: `tests/e2e/__screenshots__/workspace.spec.ts/site-workspace.png`.
- Live Mapbox probe on `http://localhost:5173`: WebGL available; style requests returned 200, imagery requests returned 429, fallback succeeded. Connected imagery success is NOT verified. No token or credential-bearing URL was printed.
- Final `make verify` passed the full sequence on 2026-10-24: backend verification, frontend formatting/types/lint/build and all 14 browser tests against freshly started local services. Owned preview servers were stopped after verification. GitHub CI execution remains pending publication.
- Phase 3 backend `make check`: formatting/lint/strict typing passed; 97 tests passed, 98.63% overall statement/branch coverage, 100% decision-engine coverage. Tests include route ranking, clock/evidence fingerprint changes, stale/all-held rejection, app restart, concurrent duplicate approval and storage-failure handling.

## Decisions in force

- Construction earthworks is the v1 vertical; the README must make cross-vertical reuse explicit.
- Real public-domain aerial imagery will be combined with clearly marked synthetic operating layers.
- Mapbox is optional; the final demo requires an offline fallback.
- Go / inspect / no-go and revised-plan decisions are deterministic and approval-gated.
- The fixed demo clock is 2026-10-24 07:00 America/Los_Angeles. Later evaluation clocks demonstrate evidence expiry; earlier clocks are rejected.
- The engine evaluates every route zone and the destination. Static closures/capability limits block operation; fresh conflicting observations require inspection. Source confidence is not a safety probability.

## Risks / unresolved work

- Revised-plan backend and teammate brief generation are implemented; the approval UI is not yet implemented or browser-verified. Multimodal similarity retrieval remains unfinished: image references are persisted, but there is no image embedding/search pipeline yet.
- Mapbox imagery requests currently return HTTP 429 in the live check. Do not infer a specific account/billing cause without further evidence. Default local aerial and all core interactions work without it.
- Seed replacement is not a cross-table transaction; run it with the API stopped. Stored data is validated before evaluation; broken or unseeded snapshots yield a recovery-oriented `503`.
- The API is local-only and unauthenticated. Run on loopback as documented; public hosting is a separate decision.
- Vite consumes the root `.env.local` as intended; its contents were not inspected or printed. The public token is visible in the browser by design, so keep origin restrictions in place and do not commit built bundles.
- Full Chromium is required for reliable local browser QA on this Mac; headless shell crashed due to its ICU/GPU runtime. CI uses the same supported full-Chromium channel.

## Next step

Phase 3: connect a plan-review/approval panel to the verified backend, then browser-test approval, held work, stale/error/reload flows and copy/export of both teammate briefs. Run `make verify`. The local preview has been restored at `http://localhost:5173` for Chrome; prefer a direct link and keep it running for the user. Mapbox 429 is an optional-provider limitation, not a blocker.
