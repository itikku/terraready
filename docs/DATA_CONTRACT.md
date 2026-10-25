# Phase 1 data and rule contract

All operational values are synthetic. These are transparent POC gates, not validated geotechnical thresholds. A `GO` means within the configured demo constraints, subject to supervisor approval. It is never a release command.

## Records

`data/fixtures/post-rain.json` is the source fixture. Pydantic validates it before a seed write. Six queryable LanceDB tables (`scenarios`, `zones`, `machines`, `routes`, `tasks`, `observations`) store separate records, joined in memory for this tiny local snapshot. No embedding model, downloaded weights or external calls are needed. Image assets and real multimodal retrieval will be added with the visual workspace; Phase 1 does not claim to implement them.

- **Scenario:** version, fixed clock, rain end, rainfall total, evidence freshness and confidence policy.
- **Zone:** local-meter polygon, slope and explicit site closure.
- **Machine:** operating mass, ground pressure, slope/moisture limits, supported operations.
- **Route:** ordered traversed zones and local-meter path; must reach the task's zone.
- **Task:** operation, assigned asset, route, duration, priority and quantity in stated units.
- **Observation:** zone, timestamp, source, note, confidence, access state, moisture fraction and bearing capacity. Image paths are deferred until actual assets exist.

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

## Expected seed outcomes

| Task | Asset | Route | Decision | Why |
| --- | --- | --- | --- | --- |
| East haul | Loaded hauler | North | `NO_GO` | North road ground limits exceeded |
| East haul | Loaded hauler | South | `GO` | Every traversed zone within configured limits |
| East excavation | Tracked excavator | North | `GO` | Same north road remains within this asset's configured limits |
| West inspection | Utility vehicle | North | `INSPECT` | West evidence predates rain; north road is marginal for this asset |

## Seeding and read semantics

Seeding explicitly resets only the six named demo tables. It first validates the entire fixture, then replaces each table. LanceDB does not provide a cross-table transaction for this seed; run seeding with the API stopped. Repeated seeding produces the same logical records without duplicates. Runtime API calls read the stored records; they never silently auto-seed, fetch cloud data or synthesize missing evidence.
