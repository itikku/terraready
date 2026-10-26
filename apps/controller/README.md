# Shared-demo controller

The deployed Cloudflare Worker and SQLite Durable Object coordinate [TerraReady's public demo](https://terraready-controller.terraready-itikku.workers.dev/demo): anonymous Start/Join, one GPU lease, persistent budget accounting, signed origin requests and automatic cleanup. Only `/owner` and `/owner/*` require owner-only Cloudflare Access. See [live evidence and limitations](../../docs/HOSTED_DEMO.md).

From the repository root, after `npm ci`:

```sh
make controller-check
```

The 56 controller tests use synthetic accounting and Cloudflare's native workerd/SQLite emulator, including HTTP admission, concurrent starts, ambiguous creation, failed-delete retries and restart after cleanup. They do not read the operating LanceDB database. `make verify` and CI include this suite. The emulator is pinned to the beta used by Wrangler 4.152.0; the lockfile overrides its HTTP dependency to Undici 7.30.1.

## Budget and lifecycle

- One unsettled lease across all visitors. A fresh server-side L4 quote and atomic reservation precede creation. Persisted attempt markers reconcile ambiguous responses; uncertainty blocks duplicate creation.
- Integer microdollars, upward rounding, $2 per Los Angeles day and $5 lifetime across all runs. Setup, disk, idle and cleanup count; prepaid balance is separate. The original 146,056-microdollar seed is retained with a later billing correction, not reset.
- Up to twenty minutes setup, thirty minutes idle, 120 minutes active from first deliberate open and five minutes shutdown margin. Available money can shorten the envelope. Joins/activity refresh only idle; polling does neither. Rental is split at local midnight.
- Durable alarms check readiness and delete only the recorded resource after ownership verification. Failed cleanup retries with the reservation held. The page distinguishes stop requested from confirmed termination.
- Confirmed absence permits a conservative usage debit and release of unused reservation. `costBasis` and `providerInvoicePending` distinguish it from provider invoices. Reconciliation remains manual; unexplained accounting puts starts on hold.

The internal `apply` binding accepts trusted server events, never arbitrary browser prices, IDs, timestamps or billing inputs. A 30-second global start cooldown and 256-run maintenance bound fail closed. These controls are not a provider-enforced spending cap; independent MCP/Pods-console recovery is still required if the controller or provider fails.

## Access and data

Reviewers get a signed opaque HttpOnly/Secure/SameSite cookie; a separately derived identity selects their synthetic workspace. Cookies are not human verification. Only the exact owner, authenticated through native `ctx.access` with the configured audience, may use setup/global-stop controls. Public owner endpoints and spoofed identity headers are rejected.

Forwarding uses a time/nonce/body/method/path/visitor HMAC envelope. Browser cookies and tokens never reach the GPU. The [origin](../../docs/HOSTED_DEMO.md#request-and-workspace-boundary) isolates approvals/audits, rejects replay, strips credentials and shares one bounded inference queue. Data is ephemeral per run, with at most 32 browser workspaces. There is no import of the existing local database.

Do not add a Static Assets binding without re-verifying owner authentication: the current internal assets router omits `ctx.access`. The frontend is served through the signed origin. [Cloudflare limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations).

## Runtime setup and evidence

The encrypted controller-only `RUNPOD_API_KEY` is configured. Its minimum current console option is Restricted → GraphQL Read/Write, AI API None; this is broad management access, not a Pod-scoped key. Never expose it to chat, source bundles, the browser or GPU. `/owner/api/setup?diagnostics=1` reports read-only Pods/catalog/billing capability states without secret values or provider bodies.

The deployed runtime pins the reviewed source release and SHA-256, container digest and approved single-L4 shape. Two live public starts reached readiness; genuine Qwen inference worked, protected owner stop triggered actual Cloudflare deletion, and fresh provider GET 404 confirmed both removals. No external deletion was needed. This proves the lifecycle, not live ten-user performance or outage resilience. See the [hosted guide](../../docs/HOSTED_DEMO.md#verified-preview) for timestamps and accounting.
