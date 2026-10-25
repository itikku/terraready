# Private GPU preview

A temporary **operator-started private preview** ran behind Cloudflare email-code Access with the production workspace and genuine Qwen inference. The preview is now off: its last GPU Pod was deleted after the ten-minute idle cutoff. The protected [session page](https://terraready-controller.terraready-itikku.workers.dev/demo) remains deployed, but cannot start a new GPU itself. The existing local app keeps its original single-user behavior.

The pilot used the operator's existing authenticated Runpod MCP for creation and exact-ID deletion. No provider-management credential was installed in the controller. Self-service starts, automatic provider cleanup from Cloudflare and invoice reconciliation are still unfinished; a deployed budget ledger is not an unattended GPU service.

## Verified preview

On 2026-10-25, owner email-code sign-in and native Access identity were verified in Chrome. The production seven-package workspace rendered through the signed gateway; users retained per-package decisions and explicit human approval. Source `985fc5f` bootstrapped the locked Linux package and real model on one L4. Unsigned origin access returned 401.

One signed assistance smoke on Pod `3538vx840p31uk` returned two genuine model responses in **1,111 ms** model-loop time (**1,469 ms** HTTP), with checked held prerequisites, explicit approval required and no fallback. A later smoke on `b9qdj8s7fm5vvw` took 1,112 ms model-loop / 2,074 ms HTTP. These are individual integration observations, not a latency distribution, GPU-memory measurement, reliability benchmark or ten-user load result. The earlier [private-GPU artifact](verification/gpu-agent.json) records a separate test of older source.

The last Pod, `b9qdj8s7fm5vvw`, reached ready at 22:36:14 UTC but recorded no first accepted use. Its ledger entered `stopping` with reason `idle`; the external agent guard deleted that exact Pod at the 22:50 UTC check and confirmed HTTP 404, repeated at 22:53 UTC. The ledger then recorded `terminated`. The completed cleanup monitor was removed. No replacement was created. Owner workspace use on the earlier Pod does not establish guest access or shared inference under live load.

## Budget controls

The approved policy is **$1.50 shared per Los Angeles calendar day**, **$5 project lifetime usage**, and **120 active minutes maximum from first genuine use**. The earlier GPU charge counts toward the lifetime limit. The separate $10 prepaid balance does not enlarge either usage limit.

The [controller ledger](../apps/controller/README.md) atomically reserves conservative whole-host costs, including setup, idle, disk and shutdown margin. It persists the first-use deadline and shutdown intent. A join does not reset a deadline or create a fresh allowance. The pilot used a twenty-minute setup cutoff, ten-minute idle cutoff and an earlier absolute operator deadline. Two active hours is a maximum, not guaranteed service; idle or cost can end a run first. Unknown accounting blocks another start.

Cloudflare alarms currently **persist shutdown intent only**. The external agent guard performed deletion through Runpod MCP; the authenticated [Pods console](https://console.runpod.io/pods) was the independent fallback. Closing a browser or seeing `stopping` does not confirm that billing ended. Exact-ID absence must be verified. This operational supervision is not a provider-enforced spending cap or completed automatic Cloudflare cleanup.

### Reservations, booked bounds and provider bills

The pilot conservatively debited some closed runs while invoices were delayed. Those records are marked `costBasis: operator_conservative_upper_bound` and `providerInvoicePending: true`; the ledger's `actual` field alone is therefore not proof of a final invoice. Reconciliation must replace these bounds with provider charges without double-counting or releasing allowance prematurely.

At the 22:53 UTC cleanup checkpoint, earlier usage had **$0.775499 conservatively booked**, and the final deleted Pod retained a **$0.724501 reservation** pending billing. Their sum exhausted the day's $1.50 allocation; it was not a claim that $1.50 had been spent. The final Pod's billing read returned no records, which means pending billing, not zero cost. No further paid start is admitted against that held allowance.

The original measured GPU test's provider bill was later revised from $0.14605502702761441 to **$0.15549830452073365**, including disk. The ledger includes that correction; the historical typed artifact retains its earlier snapshot. The provisional preview debits and unresolved reservation are separate from this observed charge. The $5 lifetime ceiling and separately approved $10 prepaid funding limit remain unchanged.

The shared origin limits the demo to one executing analysis and ten total admitted requests. A visitor can have only one executing/waiting request across all tabs, with a ten-second admission cooldown. FIFO admission prevents a repeat visitor overtaking someone already waiting. A request leaves the queue after thirty seconds waiting; existing model limits still bound execution to five responses, 960 completion tokens and 120 seconds. Overload returns HTTP 429 with Retry-After; manual planning stays available. More visitors share the leased GPU rather than automatically adding workers.

Queue bounds, isolation and accounting edge cases are verified locally with synthetic clients/accounting. The pilot adds real owner access, inference and operator cleanup evidence; it does not prove invited-user concurrency, Free-tier capacity or final live-demo economics.

## Request and workspace boundary

`terraready.hosting.HostedOrigin` requires a dedicated storage root, a new gateway secret, the public synthetic fixture and the shared model client. It refuses to initialize a nonempty unrelated directory. Each opaque visitor identity gets a separate LanceDB workspace seeded once from the public fixture. Approvals/audits persist across API restarts within that hosted run; they never reach another visitor. Storage is capped at 32 visitor workspaces per run. A partial/invalid workspace fails closed instead of resetting history. There is no user upload or existing-local-database import.

Every origin route requires a signed request, including health and readiness. A gateway must first validate the invited user's identity, strip visitor-supplied identity/signature headers, and derive a stable opaque identity from the verified subject. Email addresses, cookies and identity-provider tokens need not reach LanceDB.

The deployed Worker uses Cloudflare's platform-authenticated Access context, verifies the configured audience, derives a hashed visitor ID, and enforces owner-only start/stop control. Missing context or an account/service identity without a user UUID fails closed. Cross-origin submissions are rejected. Status polling does not refresh idle use; successful interactive POSTs do. The upstream target comes only from the ledger's exact resource ID. Redirects are not followed, cookies are stripped, and API responses are never cached. Self-service startup stays disabled; stop only records an explicitly unconfirmed shutdown intent. The pilot admitted the owner only; guest identities have not been exercised live.

Do not add a Static Assets binding to this Worker: Cloudflare's current internal assets router does not pass `ctx.access` to user code. The frontend is served through the signed origin. Changing to static edge hosting would require a separately verified JWT boundary. [Platform context and limitations](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations)

The gateway signs the following UTF-8 lines with HMAC-SHA256 using a **new 64-character lowercase hex secret as UTF-8 key bytes**. Fields are joined by newline, with no final newline:

```text
terraready-origin-v1
<Unix timestamp in seconds>
<32 lowercase hex nonce>
<64 lowercase hex visitor identity>
<uppercase HTTP method>
<exact encoded path and query, beginning with />
<lowercase SHA-256 of request body bytes>
```

Headers are `X-TR-Time`, `X-TR-Nonce`, `X-TR-Visitor`, `X-TR-Signature`. Duplicate headers, changed method/target/body/identity, timestamps over thirty seconds old or more than five seconds ahead, and nonce reuse are rejected. Nonces persist separately from domain data in a bounded local SQLite replay cache; restart does not permit replay. The body limit is 16 KiB with a five-second receive deadline. All origin responses use `Cache-Control: no-store`; the gateway preserves that policy and never caches visitor APIs or approvals.

Use one API process for one hosted run: the queue is process-local, matching the approved one-GPU deployment. Do not scale API workers independently. In-flight synchronous inference remains owned by its worker until it completes; a browser disconnect does not free another model slot. This slice has no durable job queue or background retry of a user's analysis. Restart can lose waiting requests; the client must retry, while completed approvals and audits persist.

## Hosted package and session page

The protected `/demo` page shows starting, ready, running, shutdown and pending-billing states. Opening the workspace is an explicit action; loading assets or checking status does not extend the idle deadline. The owner alone sees start/stop controls. Available budget excludes outstanding reservations. A requested shutdown is never shown as confirmed termination.

`scripts/hosted_boot.py` is for a **fresh ephemeral Linux x86_64 Pod**, using a reviewed source archive and its exact commit. It discards a provider-injected `RUNPOD_API_KEY` by membership/deletion, without reading its value, before child processes. It verifies the source manifest before opening selected files, refuses extra environment/storage/build files and symlinks, installs checksum-pinned uv 0.13.5 and Node 24.22.1, and builds from the Python/npm lockfiles. It explicitly downloads the existing pinned Qwen weights and Linux llama.cpp archive. The launcher verifies the runtime members, creates a new inference key and binds the model to loopback. Only the signed API listens on port 8000. The verified pilot used an outer entrypoint to discard the injected key; the source-level discard is a later regression fix, not a new GPU execution result.

The hosted factory serves only the public frontend build directories and the two SPA routes through the same HMAC boundary. It always uses the dedicated hosted storage root and ignores the local database setting. Hosted model sampling omits the fixed seed; feasibility, tool bounds and human approval remain deterministic. The ordinary local model keeps its previous seed.

The owner-only `/api/setup` check can perform three read-only provider requests and report capability states only. It distinguishes a missing runtime key, denied access and provider failure without returning Pod configuration, billing details or credential values. The pilot intentionally left that key absent and used the existing MCP instead. Future self-service lifecycle integration would need a separately configured encrypted controller secret and verification; it must never reach chat, source bundles or the GPU workload.

The pilot verified Linux bootstrap execution from source `985fc5f`; later source changes require their own verification before deployment. CI uses the same pinned Node and script-disabled locked npm install. The controller has not been redeployed as part of this follow-through.

## Verification and remaining gates

`make check` includes signature/replay tests, two-visitor approval/audit isolation and restart, invalid/partial storage, queue bounds/FIFO/timeout/failure/cooldown, and ten simultaneous signed HTTP clients sharing one model loop. These tests use disposable storage and a clearly labeled unavailable model; they are not a real-inference performance measurement.

Remaining before an unattended shared service: idempotent provider creation and exact-ID deletion wired to durable alarms, retries and independent failure recovery; delayed-invoice reconciliation; invited-user/device access and genuine shared-model queue/load checks; and Free-tier capacity measurements. Owner identity, the published runtime package, individual real inference and supervised cleanup are already verified. The [hosting design](reviews/HOSTING_DESIGN.md) retains the broader target. No new deployment or paid run is part of this follow-through.
