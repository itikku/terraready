# On-demand GPU demo

**[Open TerraReady](https://terraready-controller.terraready-itikku.workers.dev/demo)**. No visitor account, email code or appointment is required. Choose **Start live demo**, wait a few minutes for startup, then **Open shift workspace**. If another visitor already started it, join the same GPU. Each browser keeps its own package choices, approvals and audits for that run.

The link stays available when the GPU is off. A later visitor can start again within the shared budget. Demo data is synthetic; the model is real. Shift assessment samples without a fixed seed; typed suggestion extraction uses greedy decoding to favor faithful inputs. Ground rules and the CPU scheduling solver check feasibility; the user chooses and approves the exact work. Cameras remain an explicit stub.

Only the owner's [control page](https://terraready-controller.terraready-itikku.workers.dev/owner) requires Cloudflare email-code Access. The ordinary local application retains its single-user behavior.

The work list sits beside a larger interactive map: **Assess this shift → choose work → review and approve**. Selecting work locates it on the map; **Show the math** exposes checked inputs, limits and margins. Evidence and model traces expand on request. System leads with design, edge assumptions, model choice and evaluations; diagnostics sit in a closed Appendix.

**Suggest a change** tests a selected item's quantity, truck limit, overtime or deadline against the actual current draft. Qwen produces typed intent, then CPU CP-SAT schedules the shared resources and independent code checks its answer. The result includes a verdict, conflicts and checked alternatives. Production inputs and additional trucks are explicit hypothetical assumptions. This read-only what-if does not edit or approve the work, and it does not save the comment. [Evaluation coverage and limits](EVALS.md) distinguish genuine interpretation from protocol tests and mathematical verification.

New sessions use [source f876ba4](https://github.com/itikku/terraready/commit/f876ba43f639f30dc7c47c1cf2ef89918bb0e92e), verified by [CI40454376468](https://github.com/itikku/terraready/actions/runs/40454376468): 537 backend, 60 controller and 91 browser tests. Existing sessions keep their starting version. Startup reports total elapsed time and confirmed stages, with five-second readiness checks and no invented percentage.

## Solver-backed suggestion proof

[Image build 40455312723](https://github.com/itikku/terraready/actions/runs/40455312723)
passed. Anonymous source/image access, Linux amd64 identity and the matching source
revision were verified before enabling it. One L4 became ready in **175.457 seconds**;
this remains a multi-minute cold start, not an established speed improvement.

The real browser then exercised three Qwen requests:

| Action | Observed result |
| --- | --- |
| Request 320 bank m³ with two trucks, no overtime and retained work | NO-GO, proven infeasible. Checked alternatives: minimum fleet 3, minimum overtime 12 minutes, maximum two-truck/no-overtime volume 288 bank m³. |
| Human explicitly defers drainage, then repeats the same request | GO with an independently checked schedule; the actual draft fingerprint and selected IDs changed. Additional trucks remain hypothetical resources to obtain. |
| Ask to override bearing capacity | Clarification, null intent and no solver result. The message states that ground evidence, equipment limits and prerequisites cannot change. |

Model-loop observations were 1,607/1,138/874 ms. These are three integration cases,
not a benchmark. No approval requests were sent. Mobile overflow and accessibility
checks passed, and System showed the model rationale, three documented alternatives
and the honest 26/27 native evaluation record. [Typed evidence and schedules](verification/work-suggestions.json)
and the [genuine screenshot](images/solver-what-if.png) preserve the result.

Cleanup used the independent Runpod MCP fallback after a Cloudflare administrative
SQL stop request returned HTTP 500. Only proof Pod `t24m79fra3hi5s` was deleted; DELETE 204
and independent GET 404 confirmed absence by 05:49:42 UTC, before its 05:54 deadline.
The guard was paused. The controller later settled under its idle policy at 06:17:27 UTC.
Its **$0.443326 conservative debit** extends through controller confirmation, later
than provider absence; it is not a final invoice. No GPU remains, the controller is
off, and reservations are released. Limits remain $5/day and $10 lifetime; no funds were added.

## Verified preview

Source [`ad8fee4`](https://github.com/itikku/terraready/commit/ad8fee4222220f0eede9e55884ba1cf6d0370c61) passed [Linux CI](https://github.com/itikku/terraready/actions/runs/40270148404): 350 backend tests, 55 controller tests and 71 browser tests, plus formatting, lint, types, build, live HTTP and package checks. The controller tests include the native Workers runtime, concurrent starts, ambiguous creation, failed-delete retry and restart after cleanup.

Two real public starts were then exercised on one L4 at a time, on October 25 Pacific / October 26 UTC:

| Proof | Observed result |
| --- | --- |
| Anonymous access | `/demo` returned 200 without login; owner setup redirected to Access. A visitor could not use owner setup/stop routes. |
| First start and use | Pod `8vpga582f58al2` became ready at 04:49:34 UTC. The production workspace opened and genuine Qwen analysis displayed **1.6 seconds**, three tool steps, checked holds/prerequisites and human-review requirements, without fallback. Package choices were not changed by the assistant. |
| Automatic stop | The protected owner control requested stop. The Cloudflare alarm deleted that exact Pod and settled the ledger at 04:55:22 UTC; an independent Runpod GET returned 404. No external MCP deletion was needed. |
| Start again | A second public Start created `aefzkc71ezif9w`, ready at 04:59:17 UTC. Owner stop again led to controller deletion and settlement at 05:04:27 UTC; independent GET 404 confirmed absence. Both proof GPUs are gone. |

These are integration observations, not a latency distribution, reliability guarantee or real multiuser load test. Earlier operator previews recorded individual 1,111/1,112 ms model loops; the separate [GPU artifact](verification/gpu-agent.json) measures older source. Do not combine them into a benchmark.

## Packaged-runtime observation

[Image build 40424603460](https://github.com/itikku/terraready/actions/runs/40424603460)
passed on its second attempt. The first publication failed at the registry manifest;
a fresh workflow-token retry succeeded without broader permissions. Anonymous
manifest access, Linux amd64 identity and the source revision were verified before
enabling the immutable image. It contains the locked app, frontend, inference
runtime and checksum-pinned model; sessions no longer install or build them.

One uncached L4 start in EU-RO-1 on October 26 Pacific / October 27 UTC took
**175.834 seconds** from controller reservation to ready. About 171 seconds elapsed
before the container started; the packaged services became ready about five seconds
later. The 3.43 GB image pull dominated. An earlier source-bootstrap observation
was 181.611 seconds on a different host. These single observations do **not**
establish a meaningful cold-start speedup; first starts still take a few minutes.

The production browser then ran genuine Qwen analysis: **4.6 seconds**, three
successful tool steps, checked alternatives and held work. Selecting an excavator
package updated the map and replaced the hauler's blocked math with its own checked
values; no work was approved. System loaded the recorded native/GPU evaluations.
This is an integration smoke, separate from the historical ten-request benchmark.

After a narrowly scoped operator stop intent for this proof, the controller deleted
Pod `l52fprlft3ijao` and settled at 00:39:12 UTC. An independent provider GET returned
404. Its **$0.121990** conservative debit includes cleanup margin and is not a final
invoice. The unused reservation was released; no proof GPU remains running.

## Budget controls

The policy is **$5 shared per Los Angeles calendar day**, **$10 project lifetime usage**, and **120 active minutes maximum from the first deliberate workspace open**. Every visitor and restart shares those allowances. The separate $10 prepaid funding limit does not enlarge them.

The [controller](../apps/controller/README.md) atomically reserves whole-host cost before creation. Setup, idle, ephemeral disk and a five-minute cleanup margin count. Setup may take up to twenty minutes. A ready/active run ends after **thirty minutes without meaningful use**, with a warning and an explicit **Keep working** action near expiry. Joining or accepted interaction refreshes idle time, never the two-hour or cost deadline. Status/asset polling does not count as use. Cost can end a session sooner than either time limit.

One fixed L4 serves everyone; more visitors do not create more GPUs. One analysis executes at a time, with ten total admitted requests, one per visitor across tabs, a ten-second visitor cooldown and FIFO admission. Waiting expires after thirty seconds; model execution remains bounded to five responses, 960 completion tokens and 120 seconds. Overload returns 429 with Retry-After; manual planning remains available.

Per-item suggestions use that same admission slot for the complete model-and-solver operation. Interpretation is one model call with a sixty-second limit; the CPU optimizer has bounded solve budgets. Invalid output or an unproven schedule cannot become GO. A held or expired ground check remains authoritative, and the result states when evidence needs review rather than promising safe conditions through the schedule.

### Creation and cleanup

The Durable Object persists a reservation and unpredictable create-attempt marker before calling Runpod. A fresh server-side quote selects the approved shape; browser inputs cannot select a GPU, image or price. Concurrent starts join one unsettled run. If a create response is lost, the controller reconciles the exact attempt instead of blindly creating again.

Durable alarms check signed readiness and perform provider deletion on owner stop, setup/idle expiry or cost cutoff. Before deletion, they verify the recorded resource ID and ownership markers; failed cleanup retains the reservation and retries. `stopping` means cleanup is pending. Only confirmed provider absence/termination allows settlement. The authenticated [Pods console](https://console.runpod.io/pods) and existing MCP provide independent operator recovery.

These are application controls, **not a provider-enforced dollar cap**. Cloudflare or Runpod outages can delay cleanup. Unknown accounting fails closed. A global start cooldown and finite ledger history also fail closed rather than grow indefinitely; this is a bounded demonstration service.

### Reservations, booked bounds and provider bills

After confirmed termination, the controller books an upward-rounded conservative rental bound through cleanup, including margin, and releases the unused reservation. Records carry `costBasis: operator_conservative_upper_bound` and `providerInvoicePending: true`. The field named `actual` alone does not establish a final invoice.

The two lifecycle proofs booked **$0.143221** and **$0.126824** conservatively. With earlier reconciled provider snapshots, the ledger held **$0.817355** total at 05:04 UTC; no outstanding lease remained. These amounts are bookkeeping, not a claim of final provider spending. Earlier billing snapshots include the measured GPU test's revised **$0.15549830452073365**, including disk.

Delayed provider reconciliation remains manual: compare closed-resource bills, retain prior estimates and replace provisional debits without double-counting. An empty billing response is pending evidence, not zero cost. No automatic invoice reconciliation or Free-tier economics measurement is claimed.

## Request and workspace boundary

Reviewers receive a signed opaque `tr_visitor` cookie: HttpOnly, Secure and SameSite=Lax. A separate derived opaque identity selects their workspace. This separates browser state; it is not proof that a visitor is human. Global budget/resource/queue limits remain authoritative. Clearing cookies creates a new workspace, and ending the ephemeral run discards its storage.

Only `/owner` and `/owner/*` require the platform-authenticated Cloudflare Access context, configured audience and exact owner identity. Browser-supplied identity headers cannot grant owner rights. Cross-origin submissions are rejected. The gateway strips cookies, tokens and supplied signature headers before forwarding; email addresses do not reach LanceDB. The upstream target comes only from the ledger's exact resource ID, redirects are rejected and API responses are not cached.

`terraready.hosting.HostedOrigin` refuses an unrelated nonempty storage root. Each visitor's LanceDB workspace is seeded once from the public fixture, capped at 32 workspaces per run. Approvals/audits survive API restart within that run; partial/invalid storage fails closed. No user uploads or existing local database are imported. One API process owns the shared queue; disconnecting a browser does not free a still-running model slot. Waiting requests are not durable jobs and can be lost on API restart.

Every origin route, including readiness and frontend assets, requires HMAC-SHA256 over these UTF-8 lines, joined by newline with no final newline:

```text
terraready-origin-v1
<Unix timestamp in seconds>
<32 lowercase hex nonce>
<64 lowercase hex visitor identity>
<uppercase HTTP method>
<exact encoded path and query, beginning with />
<lowercase SHA-256 of request body bytes>
```

The new origin secret is a 64-character lowercase hex string used as UTF-8 key bytes. Headers are `X-TR-Time`, `X-TR-Nonce`, `X-TR-Visitor` and `X-TR-Signature`. Changed fields, duplicate headers, stale/future timestamps and nonce reuse are rejected. A bounded SQLite replay cache survives restart. Requests have a 16 KiB body limit and five-second receive deadline; responses use `Cache-Control: no-store`. Unsigned direct-origin access returned 401 in live verification.

Do not add a Static Assets binding without re-verifying owner authentication: Cloudflare's internal assets router does not pass `ctx.access` to user code. The frontend currently comes through the signed origin. [Platform limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations).

## Runtime provenance and credentials

The [prebuilt runtime recipe](../deploy/README.md) moves dependency installation,
frontend building and pinned model/runtime downloads into a manual GitHub image
build. The current image passed its CPU build, anonymous pull and one real GPU
integration check described above. Source tests alone do not establish GPU behavior
or faster startup. A matching source commit and immutable digest select it for new
sessions; an existing run keeps its version.

The startup page now names total startup time explicitly. Until the host reports a
signed startup stage, it describes environment download/boot without claiming the
model is loading. A prebuilt host can subsequently report model loading and actual
workspace checks; no fabricated percentage is shown.

The controller uses its own encrypted `RUNPOD_API_KEY`; it is never sent to the browser or GPU. Runpod's current restricted GraphQL Read/Write option grants broad management access rather than Pod-specific permission, so the controller checks recorded ownership before deletion. The owner-only `/owner/api/setup?diagnostics=1` performs read-only Pods/catalog/billing capability checks without returning credential values or provider bodies.

The GPU shape is one secure L4, 50 GB ephemeral disk, no mounts/SSH/Jupyter and only signed port 8000. The controller pins the container digest, full source commit and archive SHA-256. The current [source-only release](https://github.com/itikku/terraready/releases/tag/preview-source-f876ba4) contains 125 manifest-checked files; no local environment, credentials or database. The enabled image is `ghcr.io/itikku/terraready-runtime@sha256:d489c9f28d33be5c2159834d241398555727ede0b20c481d1dd3f6bd926bb4be`.

`scripts/hosted_boot.py` verifies the manifest and rejects extra environment/storage/build files and symlinks. It discards any provider-injected `RUNPOD_API_KEY` by membership/deletion without reading its value, before child processes. It installs pinned uv 0.13.5 and Node 24.22.1, builds from lockfiles, verifies pinned Qwen/llama.cpp downloads and creates a new loopback inference key. Both earlier lifecycle proofs booted sourcead8fee4. The packaged runtime uses `scripts/hosted_image.py` to verify packaged source/frontend and start the services; it also discards the injected provider key before child processes. Its later GPU proof is recorded above. Only the signed API listens publicly; model inference stays on loopback.

Remaining work is measurement and hardening: real multiuser inference load, Free-tier capacity, outage recovery exercises and automatic provider-invoice reconciliation. The current Start/use/stop/restart path is deployed and verified; these follow-ups are not prerequisites for trying it.
