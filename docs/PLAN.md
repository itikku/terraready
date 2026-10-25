# Build plan

Only the active phase may be implemented. Complete its acceptance criteria and verification steps before advancing.

## Phase 0 — Foundation and product contract

**Status:** Complete — foundation committed as `c27ba78`.

Create repository guidance, durable project records, license, research rationale, and configuration hygiene. No app code or external imagery download.

**Acceptance criteria**

- Scope, success criteria, non-goals, architecture choices, and source obligations are documented.
- `.env.local` is ignored and a placeholder `.env.example` exists.
- The repository is initialized and the foundation is committed.

**Verification**

- `git status --short`
- `git diff --check`
- Confirm `.env.local` is ignored by Git.

## Phase 1 — Data contract and deterministic decision engine

**Status:** Complete — user approved proceeding on 2026-10-24; verification recorded in `STATE.md`.

Define domain models, repeatable fixture seeding into LanceDB, and pure decision logic for `GO`, `INSPECT`, and `NO_GO`.

**Acceptance criteria**

- One command seeds the local demo data.
- Tests cover every decision outcome, stale evidence, and conflicting constraints.
- API responses are typed and include reasons, evidence references, confidence, and recommended mitigation.

**Verification**

- Backend formatting, lint/type checks, unit tests, and API integration tests.

**Implementation contract**

- Python 3.12+, FastAPI and Pydantic; local LanceDB persisted to ignored `.data/`.
- One versioned JSON fixture describes a scenario, zones, machines, routes, tasks and observations. Validate IDs, references, units and timestamps before storing any data.
- Preserve typed, queryable records in LanceDB; no JSON-only blob storage and no fabricated embeddings.
- Evaluate the task zone and every zone crossed by its selected route. Confirmed operational constraints take precedence; incomplete evidence never permits `GO`.
- Use an explicit, fixed scenario clock for a repeatable demo; accept an optional timezone-aware evaluation time for staleness tests. Report that time in each response.
- Expose a health check, scenario read API and evaluation API. Keep the API local, read-only apart from evaluation; plan approval remains Phase 3.
- Verify a real local HTTP request in addition to tests; use a disposable database in tests.

## Phase 2 — Visual site workspace

**Status:** Complete — approved by the user on 2026-10-24; verified with 14 browser tests and 76 backend tests.

Build the map-first frontend with an offline aerial fallback and optional connected Mapbox view.

**Acceptance criteria**

- The user can inspect zones, machines, route constraints, and evidence.
- Imagery / visual-source attribution is visible.
- App remains functional when Mapbox is unavailable.

**Verification**

- Frontend lint/type checks and production build.
- Playwright verifies dashboard load, zone selection, evidence view, and offline fallback.

**Implementation contract**

- React/TypeScript/Vite client, consuming the existing local API through a same-origin development proxy.
- Use a downloaded, attributed USGS aerial image and explicit synthetic geometry/evidence; no remote fonts or imagery in the fallback.
- Persist any new observation image references in LanceDB. Generated inspection photos are illustrative and never used to infer quantitative soil measurements.
- Evaluate machine-specific zone overlays through a backend read endpoint using the existing pure decision rules; do not duplicate rules in the frontend.
- Optional Mapbox is opt-in, uses the root local environment variable, and falls back automatically on token/network/WebGL failure. Never print credential-bearing network URLs.
- Playwright covers zone/evidence selection, equipment and route changes, stale evidence, offline mode, provider failure, API error and keyboard/mobile use. Capture screenshots and failure traces.

## Phase 3 — Replanning and communications

**Status:** Next phase — not started.

Add deterministic alternative-plan comparison, approval state, and role-specific shift updates.

**Acceptance criteria**

- Revised plan avoids a blocked route and preserves feasible priority work.
- The approval flow generates a field-lead inspection update and haul-coordinator route update.
- UI clearly distinguishes facts, assumptions, recommendations, and unresolved uncertainty.

**Verification**

- Unit/API tests for plan selection.
- Playwright verifies recommendation, approval, and both updates.

## Phase 4 — Demo hardening

Finish visual assets, README visuals, empty/error states, accessibility checks, CI, and a reproducible demo path.

**Acceptance criteria**

- README includes cross-vertical visual narrative, business rationale, setup, demo flow, and attribution.
- CI runs all applicable checks.
- Playwright captures screenshots, traces, and video on test failure.

**Verification**

- Full local verification suite and clean-clone setup test.
