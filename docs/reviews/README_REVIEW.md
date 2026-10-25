# README editorial critique

Expert technical-writing review, 2026-10-25, against published `816a4eb`. The [proposed README](README_DRAFT.md) is a reviewable draft; the root README is unchanged by this critique. Final screenshots and navigation wording must follow the approved implemented UX.

## The argument to make

A post-rain shift has several plausible responses, but plausibility is insufficient: ground evidence expires, machine limits differ, prerequisites block work, and resources cannot be counted twice. TerraReady demonstrates how to bound a small model's contribution while retaining independent checks and exact human approval.

That is the technical argument a reviewer should encounter first. “Local-first, multimodal shift-planning prototype for dynamic ground conditions” makes the reader assemble it from abstractions. “Multimodal” also needs immediate qualification because images are context, not model input or measurement inference.

## Prioritized findings

| Priority | Exact example / location | Reader cost | Editorial decision |
| --- | --- | --- | --- |
| P1 | The opening says “multimodal” before explaining that neither the picture nor the model produces soil readings. | An evaluator can infer an implemented vision pipeline. | Lead with the construction decision and immediately label synthetic data, stub camera and contextual images. |
| P1 | “Demo walkthrough,” “Follow one decision” and “Current build” each describe reroute → review → approval. | The reader repeats the same traversal before learning a new engineering decision. | Keep one short runnable path; use architecture space for authority, rationale and tradeoffs. |
| P1 | “What each part owns” lists files while “Why these boundaries matter” separately explains the rationale. | The reviewer has to join dependencies to use-case constraints. | Replace both with one need → decision → benefit/tradeoff matrix; link code from that matrix. |
| P1 | Verification appears in camera status, Current build, System evidence, Verify and Reproduction status; older 268/44 totals coexist with current 296/49. | Readers can confuse snapshot-specific evidence with the latest regression suite. | One proof table: current CI versus real GPU source/sample, with explicit revision boundaries. Preserve history in existing references. |
| P1 | Optional assistant walkthrough follows a different, seven-package approval scope from the three-package route flow. | “The revised plan” can imply a single policy or complete seven-package approval. | Name both scopes once and keep current UI labels accurate until the UX changes. |
| P2 | Run locally mixes the default path, v1→v2 maintenance, endpoint examples and Mapbox details. | New users must distinguish first-run steps from destructive maintenance. | Keep one fresh-checkout quickstart in README. Move operational details to [running reference](../RUNNING.md). |
| P2 | “The operating primitive” and the four-industry table precede the specific construction example. | Generality delays a concrete reason to care. | Move cross-vertical relevance after the working use case and proof; state only construction is implemented. |
| P2 | The large diagram includes API → agent → model → rules plus a separate approval/recheck path. | It duplicates the prose walkthrough and makes the main trust boundary slower to scan. | Use six main nodes and an explicit human-approved recheck path. Keep exact modules in links. |
| P2 | “Local-first,” “bounded,” “deterministic,” “explicit,” “synthetic” and “nothing dispatched” recur across many sections. | Repetition competes with the decisions those words qualify. | Retain precise boundary statements next to the claim they limit; remove repeated boilerplate. |
| P2 | The docs index exposes long internal checkpoints as the main continuation path. | An external reviewer can mistake old historical entries for the active product story. | Point primarily to the data, model, camera, running and verification references. Keep project-state documents available for maintainers. |

## Section disposition

| Current section | Action | Destination / retained value |
| --- | --- | --- |
| Opening and operating primitive | Rewrite / move | Concrete rain disruption first; one small cross-industry comparison later |
| Demo walkthrough | Shorten | One default route-review example plus optional recovery assistance |
| How the system works / Follow one decision | Merge | One diagram, authority statement and decision matrix |
| What each part owns | Remove as a standalone table | Relevant code links within the decision matrix |
| Why these boundaries matter | Rewrite | Need/decision/tradeoff rows; audited facts remain in LOCAL_AGENT |
| Camera integration status | Shorten | First-screen limitation plus CAMERAS contract; retain visible honest label |
| Current build | Merge | Actual current flow/scope in walkthrough; no second feature inventory |
| System & deployment evidence | Keep / shorten | Strong measured proof once; full artifacts and LOCAL_AGENT references |
| Run locally | Keep default path | Preserve exact commands and required versions |
| Common issues / curl examples / v2 migration | Move | RUNNING, linked immediately after quickstart |
| Verify | Keep concise | Complete verification commands and current GitHub CI link |
| Reproduction status | Move detail / retain scope | RUNNING records exact clean-checkout revisions; proof table distinguishes current tests |
| POC boundaries | Keep / compress | Explicit unimplemented capabilities and non-certification |
| Project documents / local configuration | Reorganize / move detail | Focused reference list; optional Mapbox handling in RUNNING |
| License | Keep | Code, imagery/fonts, model/runtime terms and attribution links |

## Decision-to-use-case matrix

The full proposed wording is in the draft. The required argument for each row is:

1. **Ground evidence expires and assets differ:** typed timestamped records + conservative machine/route checks; explainable rejection, but synthetic thresholds are not geotechnical validation.
2. **The model must not invent an operational fact:** focus-first, read-only tool loop + backend-rendered facts; bounded/reviewable assistance at the cost of free-form expressiveness.
3. **A response can become stale before approval:** re-evaluate exact selection and fingerprint; durable idempotent local artifact, without authenticated field sign-off or completion.
4. **A small single-host demo must be inspectable/reproducible:** typed LanceDB/Arrow + synthetic fixtures; no claim of vectors, distributed writers or multiuser isolation.
5. **A camera integration must not silently become a sensor model:** bounded snapshot contract, separate measurements; vendor acquisition and image inference remain unimplemented.
6. **A GPU result needs provenance and a cost boundary:** immutable source/model/runtime identity + measured proof/cleanup; a ten-request sample does not establish reliability or Jetson/power performance.

Hosted cost policy gets a decision row only after implementation/measurement. Until then, identify it as planned: a shared daily allowance, queue/worker bounds and durable budget checks—not an implemented savings claim.

## Acceptance and remaining work

- Draft target: roughly 1,200–1,600 words, with essential setup and limitations retained. Word count is a constraint, not the success measure.
- Verify links, fences and numerical claims against source/artifacts. Commands remain unchanged; RUNNING deliberately retains reseeding/single-writer/port/optional-model instructions.
- Current UI labels are used in the draft; refresh them and imagery after the approved UX slice. Do not publish a design mockup as a working demo screenshot.
- Human comprehension remains pending: an unfamiliar reader should identify the problem, model/rules/human boundary, two tradeoffs and default setup. No fabricated reviewer feedback or reading-time result.
- After review, promote the draft with link rebasing, verify the result, commit only deliverable files and push. Keep checkpoint/handoff changes local.
