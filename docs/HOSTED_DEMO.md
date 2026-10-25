# Shared-demo origin

The shared hosted demo is in development. Cloudflare has a locally tested budget ledger and authenticated API gateway; the opt-in Python origin provides visitor isolation and bounded model admission. Neither component is deployed. The existing local app keeps its original single-user behavior.

## Budget controls

The approved policy is **$1.50 shared per Los Angeles calendar day**, **$5 project lifetime usage**, and **120 active minutes maximum from first genuine use**. The earlier GPU charge counts toward the lifetime limit. The separate $10 prepaid balance does not enlarge either usage limit.

The [controller ledger](../apps/controller/README.md) atomically reserves conservative whole-host costs, including setup, idle, disk and shutdown margin. It persists the first-use deadline and shutdown intent. A join does not reset a deadline or create a fresh allowance. Reservations remain held until termination and billing reconciliation. Unknown accounting blocks another start.

The shared origin limits the demo to one executing analysis and ten total admitted requests. A visitor can have only one executing/waiting request across all tabs, with a ten-second admission cooldown. FIFO admission prevents a repeat visitor overtaking someone already waiting. A request leaves the queue after thirty seconds waiting; existing model limits still bound execution to five responses, 960 completion tokens and 120 seconds. Overload returns HTTP 429 with Retry-After; manual planning stays available. More visitors share the leased GPU rather than automatically adding workers.

These controls are verified locally with synthetic accounting and model protocol tests. Actual provider start/stop, independently recoverable cleanup, quota behavior and settled live-demo cost remain readiness gates. The current implementation does not establish a provider-enforced spending cap.

## Request and workspace boundary

`terraready.hosting.HostedOrigin` requires a dedicated storage root, a new gateway secret, the public synthetic fixture and the shared model client. It refuses to initialize a nonempty unrelated directory. Each opaque visitor identity gets a separate LanceDB workspace seeded once from the public fixture. Approvals/audits persist across API restarts within that hosted run; they never reach another visitor. Storage is capped at 32 visitor workspaces per run. A partial/invalid workspace fails closed instead of resetting history. There is no user upload or existing-local-database import.

Every origin route requires a signed request, including health and readiness. A gateway must first validate the invited user's identity, strip visitor-supplied identity/signature headers, and derive a stable opaque identity from the verified subject. Email addresses, cookies and identity-provider tokens need not reach LanceDB.

The implemented Worker uses Cloudflare's platform-authenticated Access context, verifies the configured audience, derives a hashed visitor ID, and enforces owner-only start/stop control. Missing context or an account/service identity without a user UUID fails closed. Cross-origin submissions are rejected. Status polling does not refresh idle use; successful interactive POSTs do. The upstream target comes only from the ledger's exact resource ID. Redirects are not followed, cookies are stripped, and API responses are never cached. Startup stays disabled pending provider/build/cleanup readiness; stop only records an explicitly unconfirmed shutdown intent.

Do not add a Static Assets binding to this Worker: Cloudflare's current internal assets router does not pass `ctx.access` to user code. The intended frontend is served through the signed origin. Changing to static edge hosting would require a separately verified JWT boundary. [Platform context and limitations](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations)

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

## Verification and remaining gates

`make check` includes signature/replay tests, two-visitor approval/audit isolation and restart, invalid/partial storage, queue bounds/FIFO/timeout/failure/cooldown, and ten simultaneous signed HTTP clients sharing one model loop. These tests use disposable storage and a clearly labeled unavailable model; they are not a real-inference performance measurement.

Still required: deployed invitation/JWT gateway and protected routing, runtime packaging, provider lifecycle and billing reconciliation, independent cleanup, Free-tier measurements, a second-device access check and genuine shared-model validation. The [hosting design](reviews/HOSTING_DESIGN.md) retains the complete readiness gates. No unauthenticated app/model exposure or paid-resource creation is authorized before those gates pass.
