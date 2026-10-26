# On-demand GPU demo

**[Open TerraReady](https://terraready-controller.terraready-itikku.workers.dev/demo)**. No visitor account, email code or appointment is required. Choose **Start live demo**, wait a few minutes for startup, then **Open shift workspace**. If another visitor already started it, join the same GPU. Each browser keeps its own package choices, approvals and audits for that run.

The link stays available when the GPU is off. A later visitor can start again within the shared budget. Demo data is synthetic; the model is real and uses sampling without a fixed seed. Rules still decide feasibility, and the user still chooses and approves the exact work. Cameras remain an explicit stub.

Only the owner's [control page](https://terraready-controller.terraready-itikku.workers.dev/owner) requires Cloudflare email-code Access. The ordinary local application retains its single-user behavior.

The current interface leads with **Assess this shift → choose work → review and approve**. Evidence and model traces are secondary views. New sessions use [source2a15cc0](https://github.com/itikku/terraready/commit/2a15cc06cf2b77685c22dbfe5a9be07016f8db6b), verified by [CI40275877244](https://github.com/itikku/terraready/actions/runs/40275877244):350 backend,56 controller and73 browser tests. Existing sessions keep the version they started with. The startup page now shows confirmed allocation/preparation stages, elapsed time and five-second checks; it does not invent a completion percentage.

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

## Budget controls

The policy is **$2 shared per Los Angeles calendar day**, **$5 project lifetime usage**, and **120 active minutes maximum from the first deliberate workspace open**. Every visitor and restart shares those allowances. The separate $10 prepaid funding limit does not enlarge them.

The [controller](../apps/controller/README.md) atomically reserves whole-host cost before creation. Setup, idle, ephemeral disk and a five-minute cleanup margin count. Setup may take up to twenty minutes. A ready/active run ends after **thirty minutes without meaningful use**, with a warning and an explicit **Keep working** action near expiry. Joining or accepted interaction refreshes idle time, never the two-hour or cost deadline. Status/asset polling does not count as use. Cost can end a session sooner than either time limit.

One fixed L4 serves everyone; more visitors do not create more GPUs. One analysis executes at a time, with ten total admitted requests, one per visitor across tabs, a ten-second visitor cooldown and FIFO admission. Waiting expires after thirty seconds; model execution remains bounded to five responses, 960 completion tokens and 120 seconds. Overload returns 429 with Retry-After; manual planning remains available.

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

The controller uses its own encrypted `RUNPOD_API_KEY`; it is never sent to the browser or GPU. Runpod's current restricted GraphQL Read/Write option grants broad management access rather than Pod-specific permission, so the controller checks recorded ownership before deletion. The owner-only `/owner/api/setup?diagnostics=1` performs read-only Pods/catalog/billing capability checks without returning credential values or provider bodies.

The GPU shape is one secure L4, 50 GB ephemeral disk, no mounts/SSH/Jupyter and only signed port 8000. The controller pins the container digest, full source commit and archive SHA-256. The current [source-only release](https://github.com/itikku/terraready/releases/tag/preview-source-2a15cc0) contains 107 manifest-checked files; no local environment, credentials or database.

`scripts/hosted_boot.py` verifies the manifest and rejects extra environment/storage/build files and symlinks. It discards any provider-injected `RUNPOD_API_KEY` by membership/deletion without reading its value, before child processes. It installs pinned uv 0.13.5 and Node 24.22.1, builds from lockfiles, verifies pinned Qwen/llama.cpp downloads and creates a new loopback inference key. Both live lifecycle proofs booted sourcead8fee4. The subsequent interface-only release has automated browser/build verification; no additional paid GPU proof was created for it. Only the signed API listens publicly; model inference stays on loopback.

Remaining work is measurement and hardening: real multiuser inference load, Free-tier capacity, outage recovery exercises and automatic provider-invoice reconciliation. The current Start/use/stop/restart path is deployed and verified; these follow-ups are not prerequisites for trying it.
