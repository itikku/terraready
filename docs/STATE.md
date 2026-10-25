# Current project state

**Updated:** 2026-10-24

## Completed

- Created the `terraready` workspace and initialized a Git repository.
- Added local Mapbox configuration hygiene: `.env.local` is ignored and `.env.example` is tracked.
- Recorded approved v1 scope, product boundaries, architecture decisions, research rationale, and phase plan.
- Configured a local Mapbox token outside version control.
- Committed the Phase 0 foundation (`docs: establish TerraReady project foundation`).

## Evidence

- Phase 0 documentation exists.
- `.env.local` exists locally and is ignored by Git.
- `git diff --check` passed on 2026-10-24.
- `git check-ignore -q .env.local` passed on 2026-10-24.

## Decisions in force

- Construction earthworks is the v1 vertical; the README must make cross-vertical reuse explicit.
- Real public-domain aerial imagery will be combined with clearly marked synthetic operating layers.
- Mapbox is optional; the final demo requires an offline fallback.
- Go / inspect / no-go and revised-plan decisions are deterministic and approval-gated.

## Risks / unresolved work

- Select a suitable NAIP crop and record provenance before adding it.
- Define the precise fixture schema and decision rules before frontend implementation.
- No application code, dependencies, tests, CI, or visual assets exist yet.

## Next step

Complete Phase 0 verification, commit the foundation, then request approval to start Phase 1 data-contract and decision-engine work.
