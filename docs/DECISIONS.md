# Architecture decisions

## 2026-10-24 — Construction earthworks first

The v1 is a post-rain earthworks shift-planning workflow for a site superintendent. Construction offers the clearest visual story and a narrow, credible POC. Cross-vertical applicability will be explicit in the README but not implemented as multiple applications.

## 2026-10-24 — Real aerial base; synthetic operational layer

The visual base will use a local, attributed crop from public-domain USDA NAIP aerial imagery. Site boundary, zones, routes, equipment, inspection evidence, and operating telemetry will be synthetic and labeled as such. This prevents a weekend prototype from making an unsupported claim of world-model realism or use of a real customer site.

## 2026-10-24 — Mapbox is optional presentation infrastructure

The connected showcase may use Mapbox GL JS when `VITE_MAPBOX_TOKEN` is present. The core demo must work without a network or token using the bundled NAIP crop. No Mapbox imagery will be committed or redistributed.

## 2026-10-24 — Deterministic decision logic

V1 recommendations will use transparent rules over fixture data. A language model may eventually help query or summarize evidence, but it will not produce or override a safety-relevant decision.

## 2026-10-24 — Local collaboration artifacts, not SaaS integrations

The system will produce role-specific shift updates locally. Slack, email, and third-party dispatch integrations are explicitly deferred.

## 2026-10-24 — MIT license

The repository will use MIT for original code and original assets. Public-domain and third-party materials retain their own status and will be recorded in `ATTRIBUTIONS.md`.

## 2026-10-24 — Phase 1 backend and persistence

Use Python 3.12, FastAPI, Pydantic and local LanceDB, with a committed `uv.lock`. Domain logic stays separate from database and HTTP code. Six typed tables store a single site's demo snapshot. Explicit Arrow schemas preserve enum, literal, nullable and timestamp fields because LanceDB's Pydantic schema conversion does not support the contract's `Literal` fields. No vector search or fabricated embeddings are introduced before actual multimodal assets exist.

The seed validates the full fixture and constructs Arrow tables before writing. It explicitly replaces only the named demo tables and is run with the API stopped; a cross-table transaction is deferred for this small POC. The API validates the complete stored snapshot before evaluating and returns a recovery-oriented `503` on missing or broken data.

## 2026-10-24 — Fixed scenario time and demo thresholds

Evaluate against the fixture's explicit clock, with optional later time for staleness testing. The engine checks the full selected route, machine capabilities, static closures and slopes, then fresh trusted post-rain observations. Conflicting evidence requires inspection; an independent static restriction still blocks operation. Source confidence is not a calibrated safety probability. Exact fields, units, rules and expected outcomes are recorded in `docs/DATA_CONTRACT.md`.

## 2026-10-24 — CI starts with the backend

Add CI in Phase 1 so every subsequent change has automated backend verification. Use the current HTTPX2 client supported by the installed Starlette TestClient. Browser tests and visual checks begin with Phase 2; their absence must be explicit until then.

## 2026-10-24 — Visual workspace and asset provenance

Use React, TypeScript and Vite with a same-origin API proxy. A local SVG renders the downloaded aerial, selectable work-zone labels and current route, so the default experience has no external dependency. Mapbox GL JS loads only after the user opts into connected satellite imagery; request, token or WebGL failure returns to the local map. Root `.env.local` is consumed by Vite without printing or moving the token. Local fonts are bundled.

The aerial is locked to USDA NAIP tile `m_3712248_nw_10_060_20220519`; exact extent, date and checksums are in `ATTRIBUTIONS.md` and `apps/web/public/imagery/source.json`. Fictional work-zone polygons follow visible cut/road areas. One generated inspection illustration is attached to the north-road observation in LanceDB, explicitly separated from the synthetic numeric measurements. Similarity retrieval is still future work; there are no invented image embeddings.

## 2026-10-24 — Automated visual and interaction QA

Use Playwright with full Chromium (`channel: chromium`); the downloaded headless-shell build crashed on this Mac due to its ICU/GPU runtime, while full Chromium runs successfully. Tests prohibit external HTTP requests and use a deliberately invalid token to exercise provider fallback without real account credentials. A reviewed map screenshot baseline permits 3% cross-platform pixel variation. Automated accessibility checks must remain enabled; initial contrast failures were repaired rather than suppressed.

## 2026-10-24 — Bounded replanning and local approval

Compare all routes reaching each task's destination with its assigned machine using the existing evaluator. Retain only `GO` work in the proposed operating plan; rank eligible alternatives by synthetic distance then ID. Preserve task priorities without pretending to optimize dependencies, shared-resource scheduling, or production. A refreshed-evidence deadline qualifies eligibility at a single clock, not for the entire planned duration.

Fingerprint the validated snapshot, effective clock and planner version. Approval recomputes this fingerprint, rejects stale proposals and all-held plans, then stores a typed LanceDB record with role-specific updates. Duplicate approval requests preserve the first local approval. This is a single-process, loopback POC with no authenticated identity and no external dispatch. Seeding replaces only the six fixture tables; approvals are retained but apply only to matching fingerprints. Chrome links are preferred over opening app-embedded previews; keep the local preview available for the user.

## 2026-10-24 — Approved decision-first scope extension

The user approved replacing the asset-score-first experience with planned commitments → disruption → feasible recovery → approval/briefing. Extend one site to 6–8 work packages with explicit prerequisites and completion state. Equipment/operator is a paired resource for this POC; independent crew rosters and a globally optimal schedule would expand the weekend scope. Rerouting alone is not resource redeployment, and approving work is not completing it. Keep these distinctions visible and testable. This supersedes the earlier fixed-assignment-only planning boundary for the new Phase 4 work, not the underlying ground-readiness rules.

## 2026-10-24 — Local assistance is bounded, real and optional

Add genuine locally served model inference over a small read-only tool allowlist. Start with a pinned llama.cpp runtime/model pair selected through at most two bounded candidates; its [tool-calling documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md) establishes runtime capability, not that a particular model is reliable on this task. Record license/revision/hash and verify actual tool use before claiming a working agent. No general framework, arbitrary shell/SQL/network, model approval authority or silent cloud fallback. Deterministic checks remain authoritative; manual planning remains available when inference fails. A mocked CI protocol server is not a real-inference benchmark.

## 2026-10-24 — Technical credibility requires observable evidence

Add a System & deployment page alongside the operator experience. Explain implemented dataflow and tradeoffs and show actual sanitized traces/verification artifacts, not decorative architecture or invented measurements. Separate implemented behavior, design intent and hardware validation. Stored image references are not multimodal search, browser network blocking is not backend isolation, and cloud GPU measurements are not Jetson measurements.

## 2026-10-24 — Private, temporary cloud GPU validation; $5 ceiling

The user does not intend to deploy to Jetson and approved a private Runpod test with a $5 usage ceiling. One modest GPU is sufficient for the intended small-model integration test; a cluster adds no required evidence. The [published Runpod prices](https://www.runpod.io/pricing), checked 2026-10-24, list A5000 24 GB at $0.27/hour and L4 at $0.59/hour, but these are not deployment quotes or guarantees of availability. Recheck compute/storage and account minimums before provisioning. [Runpod pricing documentation](https://docs.runpod.io/pods/pricing) confirms storage can remain billable while stopped; export results and verify termination/storage cleanup rather than assuming stopped means free. A larger account deposit needs separate approval. No paid resources have been created.

Keep runtime/model/data local to the test host. Download setup dependencies first, then test workload external-access denial while preserving a separate control/cleanup path and private browser access. The result can support a self-contained-deployment claim, not disconnected remote-browser access or safety certification. CPU/manual fallback, measured limitations and exact test provenance are part of the demonstration.

## 2026-10-24 — Recovery API before UI tuning

The user authorized continued work while away and deferred UI tuning. Add the versioned recovery API alongside the working route-review UI; do not discard the evidence workspace. The new docket layers explicitly onto the original site fixture rather than duplicating aerial/zone definitions. Existing version-1 databases remain readable; recovery requires explicit version-2 seeding. A recoverable local database backup was made before the development upgrade, and historical approvals were retained.

Use a deterministic commitment-first greedy selection with independent ground, prerequisite and capacity gates. Retain eligible original assignments/routes before unnecessary substitutions. Treat resource availability as serial planned-effort budgets, not a timetable. In-progress effort stays reserved even if ground becomes ineligible; automatic preemption would require an unapproved operational assumption. Custom selections are revalidated for combined capacity and duplicate task assignment. Existing route-review decisions now also respect prerequisite/capacity gates, while their fingerprints and approval records remain distinct from recovery plans.

Validate model defaults so equivalent typed snapshots have identical fingerprints before and after Arrow persistence (for example, default integer-looking values must normalize to their declared floating-point type). Approval is never an execution/completion event. These choices keep the prototype small while making the distinction between rerouting and actual ready-work redeployment testable.
