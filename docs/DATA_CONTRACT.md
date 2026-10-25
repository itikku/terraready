# Phase 1 data and rule contract

All operational values are synthetic. These are transparent POC gates, not validated geotechnical thresholds. A `GO` means within the configured demo constraints, subject to supervisor approval. It is never a release command.

## Records

`data/fixtures/post-rain.json` is the source fixture. Pydantic validates it before a seed write. Six queryable LanceDB tables (`scenarios`, `zones`, `machines`, `routes`, `tasks`, `observations`) store separate records, joined in memory for this tiny local snapshot. No embedding model, downloaded weights or external calls are needed. Image assets and real multimodal retrieval will be added with the visual workspace; Phase 1 does not claim to implement them.

- **Scenario:** version, fixed clock, rain end, rainfall total, evidence freshness and confidence policy.
- **Zone:** local-meter polygon, slope and explicit site closure.
- **Machine:** operating mass, ground pressure, slope/moisture limits, supported operations.
- **Route:** ordered traversed zones and local-meter path; must reach the task's zone.
- **Task:** operation, assigned asset, route, duration, priority and quantity in stated units.
- **Observation:** zone, timestamp, source, note, confidence, access state, moisture fraction and bearing capacity, plus an optional local image path and explicit image caption. Asset paths are restricted to `/imagery/` filenames. The north-road illustration is synthetic and does not determine measurements.

IDs are restricted to lowercase identifiers. Unknown references, duplicate IDs, naive timestamps, non-finite/out-of-range numbers and unknown fields fail validation. The seed contains a single site snapshot; any future second site requires a schema decision rather than silently mixing records.

## Decision precedence

1. Unsupported machine operation, explicit zone closure or a slope meeting/exceeding the asset limit yields `NO_GO`.
2. Otherwise, evidence must be observed by the evaluation clock, after the rain event, no more than four hours old, and at least 0.8 in source confidence. If none qualifies, return `INSPECT`.
3. Each eligible observation yields `NO_GO` if access is closed, moisture meets/exceeds the machine limit, or bearing capacity is at/below the machine ground pressure.
4. It yields `INSPECT` if access is unknown, a required ground measurement is absent, or moisture is within 0.05 of the upper limit.
5. Otherwise it yields `GO`. If eligible observations disagree on that classification, return `INSPECT` and require reconciliation.
6. Evaluate every route zone, including the destination. Overall order: `NO_GO` > `INSPECT` > `GO`.

Explicit limits are conservative at equality. Evidence confidence is the minimum source confidence among eligible observations, not a probability that work is safe. It is null when any evaluated zone lacks eligible evidence. Reasons and evidence IDs remain visible even when another constraint determines the outcome.

## Clock and snapshot semantics

The demo clock is fixed at 2026-10-24 07:00 America/Los_Angeles. `as_of` can advance it to demonstrate evidence expiry, but cannot precede the snapshot. Measurements from the future are excluded. A fresh pre-rain measurement cannot release post-rain work. Responses expose the effective clock, `policy_version: demo-v1`, `synthetic: true` and `requires_approval: true`.

The zone-readiness read endpoint (`GET /api/scenarios/post-rain/readiness?machine_id=…&as_of=…`) uses the same pure zone evaluator as task/route evaluations. The UI does not reimplement ground-readiness rules. Map geometry uses illustrative local meters aligned to the recorded Web Mercator crop; route distances are synthetic, not surveyed.

## Expected seed outcomes

| Task | Asset | Route | Decision | Why |
| --- | --- | --- | --- | --- |
| East haul | Loaded hauler | North | `NO_GO` | North road ground limits exceeded |
| East haul | Loaded hauler | South | `GO` | Every traversed zone within configured limits |
| East excavation | Tracked excavator | North | `GO` | Same north road remains within this asset's configured limits |
| West inspection | Utility vehicle | North | `INSPECT` | West evidence predates rain; north road is marginal for this asset |

## Seeding and read semantics

Seeding explicitly resets only the six named demo tables. It first validates the entire fixture, then replaces each table. LanceDB does not provide a cross-table transaction for this seed; run seeding with the API stopped. Repeated seeding produces the same logical records without duplicates. Runtime API calls read the stored records; they never silently auto-seed, fetch cloud data or synthesize missing evidence.

## Route comparison and approval

`GET /api/scenarios/post-rain/plan` compares routes reaching each task's destination for its assigned machine, at optional aware `as_of`. Every candidate uses the same evaluator. Rank by `GO`, `INSPECT`, `NO_GO`, then synthetic route distance, then stable ID. Only `GO` candidates receive a selected route; other tasks remain held. Preserve task priority, not a fabricated optimized schedule. The earliest expiry of eligible supporting evidence becomes `review_by`. Work is eligible only at the evaluation clock; targets and durations are not guaranteed production or evidence validity for the entire shift.

The SHA-256 proposal fingerprint covers the validated full snapshot, UTC-normalized effective clock and `routes-v1` planner version. `POST /api/scenarios/post-rain/approvals` accepts only `plan_id` and optional `as_of`, recomputes the proposal and returns `409` for a changed fingerprint or all-held plan. The client cannot supply decisions, identities or message contents.

A seventh, lazily created `approvals` LanceDB table stores the fingerprint, scenario, evaluation/approval timestamps, literal demo identity, planner version, typed work records and role-specific updates. Local request threads are serialized during save; repeated submissions preserve the first approval. Multiple API processes and concurrent reseeding are unsupported. Approval history survives reseeding but is shown only for an exactly matching proposal. No external message is sent; no work is dispatched. The recorded identity is a label, not authentication. Corrupt or unavailable approval storage fails with a generic `503`, never a false success.

## Version 2: work docket and recovery

`data/fixtures/post-rain.json` remains the original site/ground fixture. The explicit `data/fixtures/shift-docket.json` adds four work packages, remaining resource-hour budgets and one internal yard route. `make seed` validates both, constructs a full schema-version-2 snapshot, then replaces the same six fixture tables. Standalone `terraready-seed` without `--docket` intentionally loads only the original version-1 fixture. Neither API reads nor startup migrate or seed data.

Each task has `bucket` (`today`, `upcoming`, `prior`), `state` (`not_started`, `in_progress`, `completed`), `prerequisite_ids`, `progress_fraction`, optional `estimated_remaining_hours` and optional aware `completed_at`. Completed work requires progress 1 and a non-future completion timestamp; it consumes zero remaining capacity. In-progress work requires partial progress and an explicit positive remaining estimate; progress percentage is never converted into hours by model arithmetic. Not-started work uses its explicit remaining estimate or original planned duration. Unknown/self/duplicate prerequisites and cycles fail validation. Prior work must actually be completed.

Each equipment/operator pair has `available_hours` (0–24) at the scenario snapshot. Later evaluation clocks reduce this remaining budget by elapsed time; they do not invent task progress. Active work reserves its remaining effort even when held. No automatic preemption, travel-time model or time-slot calendar is implied. Selected work is serial per paired resource; total extra effort cannot exceed its unreserved budget. These are synthetic planning estimates, not measured idle time, utilization, monetary savings or production guarantees.

`GET /api/scenarios/post-rain/recovery` exposes seven work assessments, the original commitments, checked task/asset/route candidates, selected candidates, direct disruption, dependency blockers, resource budgets and assumptions. Each candidate keeps the existing ground/capability evaluation separate from dependency and capacity reasons. Only actual completed prerequisites permit a candidate; proposed or approved predecessors do not. In-progress work cannot be reassigned automatically.

The default policy (`recovery-v1`) preserves today's commitments before pulling forward upcoming work, within each group by priority then ID. Prefer retaining the original compatible machine/eligible route before minimizing route distance; this avoids unnecessary churn. This deterministic greedy policy is not a global optimizer. Paired-resource reassignment and pull-forward selection are separately represented. Individual candidate eligibility is not proof that a set fits together: final selection checks duplicate work and combined capacity.

`POST /api/scenarios/post-rain/recovery/evaluate` accepts optional aware `as_of` and `candidate_ids`. Omit candidates for the deterministic proposal, pass explicit IDs for a human-selected alternative, or `[]` to inspect an empty proposal. It never writes. Unknown, duplicated, ineligible or jointly over-capacity choices return `422`. A version-1 database remains readable by the original workspace but recovery returns `422` with an explicit `make seed` instruction; missing fields are not silently treated as a complete new docket.

`POST /api/scenarios/post-rain/recovery/approvals` adds the reviewed `plan_id` to that request. Recompute the proposal; reject changed fingerprints with `409`, invalid choices with `422`, and empty/all-held approvals with `409`. The SHA-256 fingerprint binds the full snapshot, UTC clock, decision-policy version, planner version and canonical selected IDs. Legacy route-only approvals use `routes-v2`; `routes-v1` historical records remain readable but cannot authorize a new recovery proposal. Both approval types share the existing typed approval table and idempotent save behavior. Approval never mutates task state or completion.

### Expected v2 fixture

- Three original commitments: east preparation (3h), hauling a **previously completed** east batch (4h), west inspection (0.5h).
- North access interrupts the haul; west inspection remains uncertain. Directly affected original effort: **4.5 planned task-hours**, not 4.5 measured idle hours.
- Preserve east preparation on its original route. Reroute the haul south. Pull forward service-yard drainage (2h, excavator) and outlet inspection (1h, utility pair).
- Keep west follow-up held on the unfinished west inspection; approving the plan does not unblock it. The prior-shift batch is historical completed work, not additional work planned for today.
- Proposed allocation: hauler 4h, excavator 5h, utility pair 1h, within separate 8h snapshot budgets. Eligibility is current-clock only; review by **10:15 PDT** or sooner if conditions change. These estimates do not establish that all planned work can finish before evidence expires.

### Upgrade / recovery

Stop the API before explicit reseeding. Preserve any needed snapshot/approval history with a database backup first; `make seed` retains the approval table, but changed fingerprints require a new review. The development database was copied to ignored `.data/backups/pre-shift-contract-lancedb-20261024/` before the v2 upgrade. This backup excludes `.env.local` and all other workspace configuration. No automatic reset is performed on errors.
