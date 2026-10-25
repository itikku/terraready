# Build plan

Only the active phase may be implemented. Complete its acceptance criteria and verification steps before advancing.

## Phase 0 — Foundation and product contract

**Status:** Active

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

Define domain models, repeatable fixture seeding into LanceDB, and pure decision logic for `GO`, `INSPECT`, and `NO_GO`.

**Acceptance criteria**

- One command seeds the local demo data.
- Tests cover every decision outcome, stale evidence, and conflicting constraints.
- API responses are typed and include reasons, evidence references, confidence, and recommended mitigation.

**Verification**

- Backend formatting, lint/type checks, unit tests, and API integration tests.

## Phase 2 — Visual site workspace

Build the map-first frontend with an offline aerial fallback and optional connected Mapbox view.

**Acceptance criteria**

- The user can inspect zones, machines, route constraints, and evidence.
- Imagery / visual-source attribution is visible.
- App remains functional when Mapbox is unavailable.

**Verification**

- Frontend lint/type checks and production build.
- Playwright verifies dashboard load, zone selection, evidence view, and offline fallback.

## Phase 3 — Replanning and communications

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
