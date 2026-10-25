# TerraReady repository guide

## Product boundary

TerraReady is a local-first, evidence-backed shift-planning prototype for construction earthworks. It helps a site superintendent decide whether a machine may work in a zone after changing ground conditions, identify when a field inspection is required, and communicate an approved plan to the relevant teammates.

This is a polished throwaway POC, not a safety-certified control system. It must never claim to autonomously dispatch or control machinery.

## Read before work

Before modifying code, read `docs/GOALS.md`, `docs/PLAN.md`, `docs/STATE.md`, `docs/DECISIONS.md`, and `docs/RESEARCH.md`, then inspect Git status.

## Working rules

- Work only on the currently approved phase in `docs/PLAN.md`.
- Keep all demo data synthetic or public-domain / openly licensed; record the source and attribution for every external asset.
- Never read, log, expose, or commit `.env.local`. Mapbox is optional; the product must have a local offline fallback.
- Keep the decision engine deterministic, explainable, and covered by tests. Model outputs may never override a safety constraint.
- Update `docs/STATE.md` with completed work, exact verification evidence, risks, and the next step before ending a phase or context.
- Do not mark UI work complete without browser automation that verifies the interaction and key visual states.

## Verification baseline

When code exists, run the checks named by the active phase. Fix failures before committing, or record the exact blocker in `docs/STATE.md`.
