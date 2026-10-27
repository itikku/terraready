# Evaluation coverage and release gates

TerraReady needs three different kinds of evidence: the model understood the request,
the mathematical answer satisfies the modeled constraints, and the user sees and
controls the correct result. Passing one layer does not establish the others.

## Coverage

| Layer | What it checks | What it cannot establish |
| --- | --- | --- |
| Engine and API tests | Ground limits, evidence age/trust, real prerequisites, capacity, exact fingerprints, input boundaries and nonmutation | Physical validity of synthetic limits or natural-language understanding |
| CPU optimizer tests | Discrete truck cycles, excavator/dump exclusivity, fleet capacity, actual prerequisite semantics, retained work, deadlines, overtime, quantity and independent schedule validation | Correct interpretation of a new human suggestion |
| Model protocol tests | Tool schema, bounded calls, malformed output, failure behavior, busy/timeout and no write authority | Genuine Qwen understanding; responses are explicitly scripted |
| Real-model semantic eval | Actual Qwen interpretation of per-item requests, paraphrases, numeric units, unsupported changes, ambiguity, holds and solver invocation | General customer-language reliability from a small curated dataset |
| Browser tests | Correct selected item/draft, retained map/list, asynchronous attribution, loading/errors/cancel, keyboard/mobile/axe and preserved human decisions | Real-model reasoning when responses are mocked |
| Hosted integration | Published artifact, signed access, queue/admission, real inference and exact resource cleanup | Sustained multiuser reliability or provider outage tolerance |

The earlier deployed application passed 382 backend, 60 controller and 78 browser
tests. Its real-model evidence was three task smokes and a separate ten-request GPU
timing sample. Those historical results do not validate the new suggestion feature.

## The suggestion dataset

[work-suggestions.json](../data/evals/work-suggestions.json) contains **27 synthetic
golden cases**. Expected results specify typed intent/status, rather than preferred
wording. The set covers:

- Equivalent paraphrases and materially different requests on the same item.
- Quantity, truck limit, overtime, deadline and retaining other work.
- Hour-to-minute normalization and explicit bank-volume units.
- Missing/ambiguous quantity or time references and unsupported operations.
- Attempts to change ground measurements, equipment limits, completion or prerequisites.
- Held, completed and stale-evidence contexts.

The HTTP evaluator exercises the actual interpreter and optimizer together. A real
run must report `local_model`; a protocol run needs the explicit `--protocol-only`
flag and is recorded separately. Reports retain case IDs, expected/actual typed
intent, solver status/gates and timings. They do not retain user comments, model
prose, credentials or arbitrary HTTP bodies.

Run only against a disposable synthetic API or the approved hosted demo:

```sh
.venv/bin/python scripts/evaluate_suggestions.py \
  --base-url http://127.0.0.1:8004 \
  --output .data/reports/suggestion-real-eval.json
```

The origin is required explicitly. The evaluator rejects the original local port
8000, credential-bearing URLs and unrelated hosts. Output creation is exclusive;
subsequent per-case checkpoints preserve partial failures if a run is interrupted.

## Mathematical evidence

The optimizer schedules individual loading, travel, dumping and return activities.
It accounts for a shared excavator, available truck/operator pairs, dump capacity,
other selected work, real prerequisite state and the requested time/quantity limits.
Production parameters are explicit synthetic assumptions, not inferred measurements.

Every returned feasible schedule is checked independently of the solver API for
interval overlap, instantaneous resource use, volume accounting, prerequisites,
deadlines and completion. `OPTIMAL` includes the objective bound; `FEASIBLE` means a
valid witness without proof of optimality. `UNKNOWN` or timeout cannot become a
verified GO. A reported infeasibility conflict is sufficient, not necessarily minimal.

For optional trip indicators `pᵢ ∈ {0,1}`, delivered volume is `16 × Σpᵢ` bank m³.
At every minute, active truck cycles satisfy `Σ pᵢ·1[sᵢ ≤ t < eᵢ] ≤ fleet`.
Excavator jobs/loading and dump services have separate non-overlap constraints;
prerequisite order, item deadlines and `finish ≤ shift + overtime` constrain the
schedule. Fleet, finish and volume are optimized in separate solves with explicit
objective bounds. The [verification artifact](verification/work-suggestions.json)
contains the complete checked example and typed real-model results.

The standalone research proof used an illustrative new batch with preparation before
hauling. The integrated site uses the actual completed prior-batch prerequisite;
its resulting schedule and overtime can differ. Neither result may be silently
substituted for the other. A future planned inspection never creates favorable
observations or marks an actual prerequisite complete.

## Gates before enabling the feature

1. Formatting, lint, strict types, production build and applicable engine/API,
   optimizer, controller and browser suites pass. Failures and visual differences
   are retained and inspected, not hidden by weakening assertions.
2. Run the complete 27-case real Qwen set and retain exact expected/actual results.
   Supported requests must preserve their intended constraints; invented numeric
   constraints, an unauthorized hold override, unverified GO, a changed draft or a
   false real-model label block release. This read-only MVP accepts the one documented
   safe-refusal labeling mismatch below. Its score remains 26/27; the golden and
   evaluator are unchanged.
3. Changed suggestions produce changed mathematical problems; equivalent paraphrases
   preserve their intended constraints. Solver failure and model outage preserve
   existing work choices and manual approval.
4. Green CI, immutable source/image provenance and a real integration observation
   precede hosted availability. A paid check also requires fresh budget/capacity
   and exact-resource cleanup gates; existing visitor sessions are preserved.

Initial real-model failures remain evidence. If the prompt is repaired using these
cases, the passing set becomes a regression set, not an untouched held-out estimate.
New unseen phrasing, repeated sampling, real customer review, larger scheduling
instances, multiuser load and operational/soil validation remain separate work.

## Current suggestion results

Full actual Qwen runs progressed **12/27 → 10/27 → 23/27 → 26/27**. Failed reports
are retained; the golden cases never changed. Early failures exposed invented
deadlines, missing explicit zero overtime, ambiguous volume units, a clamped fleet
request and a completed-item request. Repairs separate requested values from defaults,
raw quantity from its basis, time purposes from each other, and clock arithmetic
from language interpretation. Application code requires a source phrase such as
`bank m³` or `in-place cubic metres`; the model cannot manufacture a missing unit.

The final full run met exact intent/status and solver-gate expectations for **26/27**
cases. In `soil-override`, the model requested clarification instead of the expected
unsupported-change response. It returned **null intent and no solver result**. The
evaluator deliberately still exits with a failed score for this mismatch. This is
an accepted refusal-reason limitation for the synthetic, read-only MVP: it does not
grant any authority to change observations or produce a hypothetical plan. API and
orchestration tests establish nonmutation; the real report itself does not contain
per-case before/after database snapshots.

The earlier all-labels-exact release gate was refined after inspecting this remaining
failure: a safe refusal with the wrong reason does not justify a second model workflow
for this MVP. Numerical meaning, ground holds, independent schedule validation and
human approval remain hard gates. A copy-only clarification now explicitly states
that ground evidence, equipment limits and prerequisites cannot be changed. The
measured model prompt and interpretation logic are unchanged by that copy edit.

Typed extraction uses greedy decoding with a 192-token response cap and one call
within sixty seconds. The ordinary hosted shift assessment remains sampled without
a fixed seed. This native evaluation used the existing seed42 configuration; greedy
decoding is not a promise of identical outputs across runtimes or hardware.

Final isolated checks pass **537 backend tests**, with **98.25%** API statement/branch
coverage, including **47 optimizer tests**; formatting, lint, strict types and the
production frontend build pass. The full **91 browser** and **60 controller** checks
pass, followed by **26 focused browser** checks for the final suggestion flow and
System disclosure. Browser inference remains scripted. Hosted integration is pending
and must not be inferred from these native and protocol checks.
