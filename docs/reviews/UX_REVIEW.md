# Demo UX critique and proposed direction

Expert review, 2026-10-25. Application: `9249889`; published documentation: `816a4eb`. This is an inspection of implemented behavior, not customer research. The interactive [three-state proposal](ux-proposal.html) is a design artifact; it does not save approvals or run a model.

**Direction approved:** the user chose shift-first recovery, with map/evidence and scoped route comparison supporting it. They further required real decisions on each item. Implementation must let the user defer an eligible package or choose a checked route/resource alternative per package, then revalidate the combined exact selection. The prototype's fixed four-assignment preview illustrates hierarchy only; it is not the final decision editor.

## What the first screen should answer

The superintendent's job is to recover a disrupted shift. Lead with **what changed → what can continue → what stays held → review the exact response → brief teammates**. The map and measurements explain a decision; they should be reachable from that decision.

The working constraints are a strength. In the isolated walkthrough, expired evidence removed approval/briefs, unavailable inference remained explicitly labeled, failed approval produced no recovery brief, and manual approval survived reload. Preserve these behaviors while changing hierarchy and copy.

## Findings

Priorities reflect expert judgment: P1 affects the core decision; P2 increases interpretation or navigation effort. Effort is relative, not an estimate of elapsed time.

| Priority | Observation and evidence | User consequence | Proposed improvement | Effort |
| --- | --- | --- | --- | --- |
| P1 | At 1512×1100, the task heading begins at y=1231, route-plan heading at 1375 and review at 2119. At 390×844, review begins at 3412 and assistance at 3689. | The first screen explains ground but does not offer the response to the disrupted shift. | Put the disruption, proposed work, holds and a review action before the map. | Medium |
| P1 | Route review says 2/3 packages eligible; the actual recovery response contains seven packages: four proposed, two held, one completed. | “The plan” has competing meanings; a visitor can miss both pull-forward work and the blocked successor. | Make seven-package recovery primary. Label the original comparison “Route comparison · 3 originally scheduled packages.” | Medium |
| P1 | The route planner sends the excavator south; recovery retains its eligible original north route. Both are valid under their documented policies. | Different answers can look like an error when their scope and selection policy are hidden. | Preserve both policies and approval records. Put route comparison under supporting investigation with its scope/policy stated before approval. | Small–medium |
| P1 | Full recovery review currently follows an assistant request, including when the model is unavailable and returns rules-only recovery. | An optional model appears to be the doorway to the most useful planning capability. | Load default checked recovery directly. Assistance may narrow a separate exact selection, but is optional. | Medium |
| P2 | The H1 is “Good ground. Better decisions.”; the plan headline is “Keep the work. Change the plan.” | Headings provide little navigation information and do not name the disruption or action. | Use specific task and outcome headings; proposed copy below. | Small |
| P2 | “92% source confidence” appears prominently beside soil readings; its qualification is smaller. | A skim reader may interpret an observation attribute as a probability of safe operation. | Show the reason, source and timestamp first. Put confidence beside its explanation in evidence detail. Keep it available. | Small |
| P2 | “Local site memory,” “READ-ONLY INTELLIGENCE,” model ID and audit-storage wording occupy operator-facing space. | The interface asks the superintendent to interpret implementation vocabulary. | Use “Demo snapshot,” “Ask about this shift” and a concise source label; move runtime/audit detail to expandable evidence or System. | Small |
| P2 | Camera stub labeling is honest, but “Refresh camera snapshot” is shown even when no provider is connected. | Refresh suggests a new capture might appear in the disconnected default demo. | Keep the stub notice; offer refresh for configured adapters and a setup link in the appropriate developer view. | Small |
| P2 | Site-data failure instructs the user to seed the demo. | An operator is given a maintenance action that can replace fixture tables. | Offer Retry as the primary action; put owner setup/recovery instructions in supporting help. | Small |
| P2 | Some important recovery rules are embedded in long paragraphs next to repeated boundary statements. | The user must find which sentences affect this approval. | Keep selection, held work and evidence deadline next to approval. Use a single persistent synthetic-data label and adjacent camera/model provenance. | Small–medium |

The recorded positions are page coordinates, not task-completion times. Mobile has no document-level horizontal overflow in the observed state; that does not make its information order effective.

## Proposed information architecture

| Surface | Primary content/action | Supporting content |
| --- | --- | --- |
| Shift recovery | Concrete disruption; 4 proposed / 2 held / 1 completed; **Review 4 assignments** | Snapshot time, deadline; explanation of each change |
| Exact review | Selected task/resource/route/effort; held work and unfinished prerequisites; evidence deadline; explicit checkbox and approval | Resource budgets, evidence references and full planning assumptions |
| Approved brief | What was saved and which selection it covers; copy field-lead or haul-coordinator brief | Holds and deadline remain visible; approval does not complete or dispatch work |
| Inspect evidence | Existing map, equipment-specific readiness, numerical sources and camera provenance | Clearly scoped original route comparison; separate approval contract |
| Optional assistance | Ask a question, inspect actual-model/fallback identity, review checked references | Observable tool/audit detail; model never approves |
| System | Runtime reachability, historical measurements, implementation limits | Future measured hosting costs; no decorative live budget until enforced |

The proposal uses the **actual default recovery response**, not a newly invented schedule. Four ready assignments do not mean four machines operating simultaneously. They consume the existing paired-resource planned-effort budgets. Completed work is distinguished from proposed work; approval changes neither completion nor prerequisites.

### Three core states

1. **Disrupted shift:** “Rain blocks north access for the loaded hauler.” Show continuing excavation, hauling via south access and two ready yard packages. West inspection and its successor remain held. The review button is visible before supporting map detail on desktop and phone.
2. **Exact review:** show all four selected assignments, two holds, 10:15 PDT evidence review and resource use. Nothing is approved until the user confirms that selection. Any changed selection/snapshot clears confirmation.
3. **Approved brief:** show the two role-specific updates. Use “Approved response” and “Copy field-lead brief”; retain what remains held and the review deadline. Never imply that copying sends a message.

## Copy inventory

These are proposed customer-language choices, awaiting review with the user. Dynamic numbers/statuses must come from typed API results.

| Current copy | Proposed copy | Reason |
| --- | --- | --- |
| Good ground. Better decisions. | Recover today's shift | Names the job |
| A clear view of where your equipment can work today. | Review what can continue after the rain—and what must wait. | States the consequence and next action |
| 18 mm overnight. A different site this morning. | 18 mm of rain. North access is closed to the loaded hauler under the demo rules. | Names the affected asset; no site-wide closure claim |
| Keep the work. Change the plan. | Review the recovery | Names the action |
| Compare every access route. Keep uncertainty out of the operating plan. | Check selected work, holds and the evidence deadline before approval. | Observable action instead of an absolute assurance |
| Original plan / Proposed plan, 2/3 | Route comparison · 3 originally scheduled packages | Makes the existing scope explicit |
| READ-ONLY INTELLIGENCE | Optional assistance | Efficient operator language |
| Ask about the recovery. | Ask about this shift | Concrete context |
| Analyze locally | Analyze shift | “Locally” belongs in provenance; current manual mode still says Local model when it actually runs |
| Rules-only fallback · model did not finish | Model unavailable · showing checked recovery | Use the actual fallback reason: unavailable, timeout, invalid output or request limit |
| Inference outcome: unavailable… | The model is unavailable. You can still review the recovery below. | Actionable, with no successful-model implication |
| Local model · rules checked | Model-assisted analysis · rules checked | Clear boundary; show actual runtime identity in detail |
| Human review · selected recovery | Review these 4 assignments | States exact selection size |
| Approve selected recovery | Approve these 4 assignments | Binds action to the reviewed selection |
| Approved locally. Ready to brief the team. | Response approved. Prepare the team briefs. | States saved outcome and next step; retain “Saved locally” in provenance |
| Copy update | Copy field-lead brief / Copy haul brief | Names the artifact/action |
| Local site memory | Demo snapshot · 07:00 PDT | Explains the time basis instead of storage |
| Source confidence | Observation confidence · what this means | Keep its non-safety-probability explanation adjacent |
| Site data unavailable. Seed the demo… | Site data could not be loaded. Retry, or ask the demo owner to check setup. | Separates recovery from destructive maintenance |
| Demo camera stub · no camera connected… | Demo camera · no camera connected. Fixed illustration. | Keep the existing truthful boundary with fewer words |

## Exception and transition contract

| State | Visible result and next step |
| --- | --- |
| Loading recovery | “Checking this shift…”; no stale actionable proposal or enabled approval |
| No eligible work / expired observations | “Get fresh evidence before approving work”; retain holds/reasons and an inspection next step |
| API unavailable | Clear error + Retry; retain investigation if its data is valid, never pretend a stale plan is current |
| Model busy / timeout / malformed response | Label the actual failure and show checked manual recovery; assistance never blocks the main flow |
| Selection or snapshot changes | Cancel/ignore old responses; clear confirmation; recheck the new exact selection |
| Approval fails or conflicts | No success/brief; safe retry or refreshed review, with the selection still identifiable |
| Saved approval | Brief and displayed selection use the same fingerprint; repeat click cannot create a new meaning |
| Camera missing / corrupt / old-zone response | Explicit unavailable/provenance; never substitute a synthetic image as a real capture |
| Hosted startup / queue / budget pause | Separate future state contract; daily budget is shared and may pause inference before the active-use deadline |

## Small implementation slice and acceptance gate

First add a default seven-package recovery view before the map, with direct manual review. Reuse existing `/recovery`, `/recovery/evaluate` and `/recovery/approvals`; do not change domain policy, storage schema or approval meaning. Retain the current equipment/evidence workspace and clearly scoped route approval. Keep optional assistance available without merging its selections with the primary proposal. No dependency/design-system overhaul.

Review the [interactive proposal](ux-proposal.html) before this material IA change. Then implement and verify: normal/expired/all-held flow, request races and late responses, selection changes, approval errors/repeated clicks, correct copied brief and reload; keyboard/focus/status announcements, 390 px layout, 200% browser zoom, axe and deliberately inspected screenshots. Run `make verify` and real HTTP smoke in isolation; preserve prior evidence and services. Neither the proposal nor this review is a completed UI implementation.

Five comprehension prompts remain for the human review: What changed? What can continue? What stays held? What is the next action? What does approval authorize? Record actual answers; the inspection above cannot establish customer comprehension.

## Evidence obtained

Eight walkthrough checks passed against a new synthetic database at a separate API port: initial/stub state, mobile overflow, approval/correct clipboard/reload, expiry, actual unavailable-client fallback and exact recovery review, injected failed approval, System/back navigation, injected site failure/retry. Zero external browser requests and page errors. No real model/hardware inference was run. Failure injection is labeled; it is not evidence of an actual model outage.

Screenshots, JSON, harness and trace are retained under ignored `.data/reports/optimization/`. An initial harness selector omitted the camera paragraph's punctuation; corrected the selector and retained its failure artifacts. No product code changed to pass the walkthrough. The original data, credentials, user browser and preview API state were untouched. Prior full application and GitHub results remain separate from this focused review.
