# Build plan

Only the active phase may be implemented. Complete its acceptance criteria and verification steps before advancing. The user approved the revised product direction and a private $5 GPU-test ceiling on 2026-10-24. That is not blanket permission for larger deposits, public exposure, extra integrations or skipping the phase gates below.

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

**Status:** Original bounded slice complete — 97 backend tests and 24 browser tests pass. The user has identified a broader workflow gap; agree the follow-up below before advancing.

Add deterministic alternative-plan comparison, approval state, and role-specific shift updates.

**Acceptance criteria**

- Revised plan avoids a blocked route and preserves feasible priority work.
- The approval flow generates a field-lead inspection update and haul-coordinator route update.
- UI clearly distinguishes facts, assumptions, recommendations, and unresolved uncertainty.

**Verification**

- Unit/API tests for plan selection.
- Playwright verifies recommendation, approval, and both updates.

**Implementation contract**

- Reuse the existing evaluator to compare routes for each task's assigned machine. Choose an eligible route by shortest synthetic distance, then stable ID; never substitute equipment or invent a schedule.
- Compare the original plan with the proposed plan at the explicit evidence clock. Quantities are planned targets, not guaranteed production; show the earliest evidence-review deadline.
- Held tasks remain held after approval. Inspection requests must not instruct entry onto unverified ground.
- Recompute the proposal on approval and reject a mismatched snapshot fingerprint or a proposal with no eligible work. Persist one idempotent, typed local approval record per fingerprint in LanceDB.
- Generate copyable/exportable updates only after approval. No external messages, real identities, dispatch, or authentication claims.
- Verify planner edge cases, durable/idempotent approval, stale-proposal rejection, browser approval/error/reload/clock flows, clipboard/export, mobile and accessibility. Commit backend and UI as separately verified slices.

## Phase 4A — Decision-first work contract and recovery engine

**Status:** Complete — 155 backend tests, live recovery smoke and 24 browser regression tests pass. UI tuning remains deferred.

**Boundary and design**

- Keep one synthetic site, three assets, the existing local imagery and fixed evidence clock. Extend to 6–8 work packages spanning completed, today's planned and upcoming work. Treat equipment/operator as a paired resource; do not add a separate workforce system.
- Define typed prerequisites, explicit completion/progress state, planned targets/durations, priority and resource compatibility. Validate unknown IDs, self-dependencies and cycles at the input boundary. Store new fields as queryable typed LanceDB records, not opaque blobs.
- Preserve the original plan separately from recommended changes. Distinguish ground eligibility, dependency eligibility, resource availability and priority; do not compress all four into one unexplained score.
- Reuse the existing evaluator for every candidate task/asset/route. Generate a small deterministic set of feasible reroute or pull-forward/redeployment choices, with stable ordering. No global optimization or LLM-generated feasibility.
- Approval does not complete work or satisfy prerequisites. Simultaneous suggestions must not double-book the same paired resource. Respect remaining modeled capacity, and distinguish planned capacity from measured savings.
- Include reroute recovery, a genuinely held package, its blocked successor, and at least one compatible ready alternative. Support both reroute and redeployment through the core docket; additional edge cases may be isolated test fixtures rather than a new scenario-management UI.
- Bind approvals to the full relevant snapshot, clock, decision/planning policy versions and selected proposal. Recompute constraints before saving; old route-only approvals must not approve a new assignment plan.

**Observable acceptance criteria**

1. The API exposes original commitments and their direct/downstream disruption, with explicit reason/evidence references.
2. A held predecessor excludes its successor; a completed prerequisite permits evaluation but never overrides ground or asset constraints.
3. A compatible available resource can be offered ready backlog work; incompatible, over-capacity and conflicting assignments are rejected.
4. Reroute recovery and genuine redeployment are separately demonstrated. All-held/expired-evidence cases cannot be approved.
5. Existing machine-specific readiness and durable approval behavior remain correct. Fixture/schema changes have an explicit seed/recovery path; no silent database reset.

**Verification and commit gate**

- `make check`: model, planner, storage and API tests covering every criterion, plus repeat-seed/round-trip and unchanged legacy ground rules.
- Extend `make smoke` with real HTTP assertions for disruption, dependency exclusion and redeployment.
- Update `docs/DATA_CONTRACT.md`, `docs/STATE.md` and decisions; commit the verified backend slice. Present results and obtain approval before Phase 4B.

## Phase 4B — Shift-first decision experience

**Status:** Deferred at the user's request on 2026-10-24. Keep the current UI functional; backend/agent work may proceed without cosmetic tuning.

**Experience**

- Default entry: **Today’s shift** → **What changed** → **Recovery options** → **Approve & brief**. Show targets, prerequisites, resource allocation and clearly labeled assumptions before the asset scores.
- Keep the map/evidence workspace accessible as the supporting investigation view. Preserve attribution, imagery fallback and machine-specific analysis; do not rebuild the visual foundation.
- Show original versus proposed work and why each excluded alternative is ineligible. Present model assistance later as optional support, not a mandatory chat interface.
- Keep meaningful loading/empty/error states and keyboard/mobile navigation. Use small view components instead of expanding a monolithic app component; no new design system or routing dependency unless demonstrably needed.

**Acceptance and verification**

- Playwright completes the superintendent journey without external requests: identify disrupted commitment, inspect evidence, choose a feasible recovery, see blocked successors stay held, approve and copy/download the correct teammate briefs.
- Assert displayed impact/capacity numbers against API results. Test stale proposal, expired evidence, no alternatives, API failure/retry, persisted reload, keyboard use and 390px mobile layout.
- `make verify`; zero critical-flow axe violations; visually inspect revised desktop/mobile artifacts. Review actual screenshot differences before changing baselines.
- Update state and commit the verified UX slice. Obtain approval before Phase 5.

## Phase 5 — Real local agent with a bounded tool surface

**Status:** Active — Phase 4A verified. User authorized autonomous continuation while away, deferring UI tuning. No hosted model API or paid GPU needed to write/test the integration. Stop for material ambiguity, missing account access or expanded spending/exposure, not routine implementation approval.

**Architecture and bounds**

- Serve one small quantized instruction model via a pinned local runtime, initially evaluate llama.cpp. Pick and record an exact model revision, license, quantization, hash and compatible tool template after a bounded smoke evaluation (at most two candidates); do not call an untested adapter a working agent.
- Implement a minimal backend tool loop, not a general agent framework. Allow only structured read-only operations: inspect shift/prerequisites, retrieve stored evidence, list checked recovery candidates and evaluate a candidate through existing rules. No shell, arbitrary SQL, filesystem, arbitrary URL, dispatch or approval tools.
- Bound steps, tokens, response size and wall time; validate tool arguments and final referenced IDs. Treat observation text as data, not instructions. Numeric impacts come from checked backend results, not model arithmetic.
- The model may compare/explain validated options; it cannot change completion state, manufacture evidence, relax constraints or self-approve. Approval always revalidates the chosen assignment.
- Record observable tool calls/results, IDs, timings and user-facing rationale—not hidden chain-of-thought. Persist useful typed run metadata locally. Distinguish actual inference from deterministic fallback in the UI.
- Model timeout, unavailable runtime, malformed output, unknown references or exhausted budgets must fail safely to manual deterministic planning. No silent cloud fallback.
- Evidence retrieval initially uses real stored records. Do not claim image embeddings/visual inference; genuine multimodal similarity search remains a separately scoped enhancement.

**Acceptance and verification**

- Unit/API tests exercise allowlist enforcement, injection-like evidence, invented IDs, invalid arguments/output, timeout and budget exhaustion; no unsafe candidate can reach an approved plan.
- Playwright covers assist → visible grounded recommendation/trace → human review, plus inference-unavailable fallback and retry. CI uses a labeled deterministic fake server for reproducible protocol/error tests; this does NOT count as a real-model test.
- A separately labeled real-model smoke/evaluation run must demonstrate tool use on reroute, redeployment and blocked-prerequisite questions. Save exact runtime/model identifiers and outcomes. Local CPU execution is acceptable for early integration; performance claims wait for Phase 7.
- `make verify`; record evidence and commit. Obtain approval before Phase 6.

## Phase 6 — System & deployment evidence page

**Status:** Planned — approval gate after Phase 5.

**Acceptance criteria**

- A navigable, directly addressable page explains the actual dataflow: local evidence/LanceDB → bounded model tools → deterministic checks → human approval → local briefs.
- Link design decisions to observable behavior: typed local storage, freshness rules, dependency/capability gates, model failure fallback, fingerprinted approval and absence of external dispatch.
- Show actual runtime availability separately from last test results. Label **implemented here**, **designed for edge** and **hardware-tested** accurately; no green badges for planned work or browser-only network blocking presented as full-stack offline proof.
- Read sanitized verification artifacts with commit, dataset/model/runtime versions, hardware, test outcomes and timings. Missing artifacts display **not measured**, never sample metrics masquerading as measurements.
- Explain that NAIP imagery is real, operational values/inspection illustration are synthetic, and images do not establish soil measurements. Cross-vertical architecture is a thesis, not four implemented applications.
- Phase 7 adds actual GPU/offline/cost results through the same artifact contract; no fabricated preliminary results.

**Verification**

- `make verify`; browser navigation/deep-link/back behavior, missing/invalid artifacts, truthful unavailable states, accessibility and mobile checks. Inspect page screenshots, update state and commit. Obtain approval at the GPU readiness gate before Phase 7.

## Phase 7 — Private single-GPU integration test

**Status:** Approved in principle: Runpod, private temporary test, cumulative usage ceiling $5. Provisioning waits for completed local slices, account access and a documented readiness gate; no resources currently exist.

**Readiness / spending gate**

- Check the actual available instance quote, compute plus storage, account minimum/deposit and remaining budget. Prefer one modest 24 GB GPU; no cluster, always-on service or unrestricted automatic GPU substitution.
- A required deposit above the approved $5 outlay, a higher budget, new payment details or public exposure requires explicit user approval. Keep credentials outside Git and never read/upload the existing Mapbox `.env.local`; use the bundled aerial remotely.
- Prepare/pin the image, dependencies, weights and fixtures before the paid test where practical. Show the expected maximum runtime/cost and a shutdown deadline with margin; establish external cleanup/control independent of the workload's outbound network.
- Use a private tunnel/access path; do not expose the current unauthenticated API or inference server publicly. Start only the identified test resource; preserve artifact IDs for exact cleanup.

**Acceptance criteria**

1. Run frontend, API, local LanceDB and the actual local model together. Browser tests complete disruption → recovery → grounded assistance → approval → teammate briefs.
2. After preload, deny workload external access using verified platform/container controls. A deliberately attempted external probe fails while local inference, retrieval, planning and the browser journey continue. Browser request blocking alone is insufficient; do not block the provider control/cleanup path accidentally.
3. Exercise inference failure and evidence expiry on the real deployment; deterministic manual review remains available and holds never become unjustified `GO` decisions.
4. Record GPU/host identity, software/model hashes, cold/warm timings, peak memory/VRAM, a declared bounded latency sample (with count and p50/p95), outcomes and observed provider charges. Report resource/measurement limits honestly; no Jetson, power-efficiency or production safety claims.
5. Export only sanitized reports/screenshots/traces. Terminate the exact test instance and remove unneeded test storage after verifying exports; confirm no residual billable resources. Record final usage against the $5 ceiling. A proposed ceiling is not a provider-enforced hard cap; do not claim otherwise.

**Verification and handoff**

- Local `make verify` plus the documented private-deployment browser suite, real inference evaluation, backend egress-denial probe and cleanup/billing checks.
- Save sanitized results for the system page and README; preserve enough identifiers to reproduce the test, never credentials. Update state, commit and present results. Obtain approval before final publication/hardening.

## Phase 8 — Reproducible portfolio handoff

**Status:** Planned — approval gate after Phase 7.

- README includes the decision-first demo flow, cross-vertical visual narrative/images, business rationale, architecture tradeoffs, honest implementation/validation limits, setup, actual results, license and attribution.
- Clean-clone setup verifies locked dependencies, explicit seeding, missing-model behavior and the default offline visual experience. Model downloads are an explicit setup step with source/license/hash, not a hidden runtime network call.
- CI runs deterministic backend/frontend/browser verification with failure artifacts. Real-GPU testing stays an explicit bounded task, not an automatic bill-generating CI job.
- Run `make verify`, source/package secret/data checks and the clean-clone path. Commit each verified slice. GitHub publication or a public hosted demo is a separate user-authorized step; the private GPU test does not authorize either.
