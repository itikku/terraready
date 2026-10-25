# Shared-demo controller readiness

This contains the local budget/deadline proof and authenticated API-gateway boundary for the approved Cloudflare Free design. It is **not a deployed service**. With its bindings/access unconfigured, every public Worker request returns 503. There is no Runpod lifecycle client, deployment credential, configured invitation policy, hosted start page or live provisioning.

From the repository root, after `npm ci`:

```sh
make controller-check
```

The Node tests run the policy and Cloudflare's workerd/SQLite emulator. They use temporary synthetic accounting, internal Durable Object bindings and no external Worker requests; emulator telemetry is disabled. They do not touch the operating LanceDB database. The normal `make verify` and GitHub workspace checks include this suite.

## What the ledger proves

- One unsettled lease at a time, shared by all visitors. A repeated start key preserves its reservation; ambiguous creation blocks another start.
- Integer microdollar accounting, upward rounding, $1.50 per Los Angeles day and $5 lifetime. The prior $0.14605502702761441 charge is seeded once as 146,056 microdollars. Prepaid balance is separate.
- A whole-host reservation covers up to 20 minutes setup, ten minutes waiting for first use, 120 minutes active use and five minutes shutdown. A budget can shorten that envelope. Fixed costs/margin are reserved once; elapsed rental is split at local midnight. These are policy assumptions to verify against a fresh all-in quote.
- A deliberate `open` event starts the active clock after readiness. Joins and accepted activity refresh only the ten-minute idle deadline. Polling does neither. Earlier cost/setup/idle deadlines prevail.
- Exact resource identity, confirmed termination and reconciled billing are required before releasing a reservation. Unexpected charges are recorded and put accounting on hold.

The internal `apply` binding accepts trusted server events only; timestamps come from the controller. The gateway derives open/activity/stop events from authenticated actions; it never passes arbitrary browser events or quote/billing inputs through. Domain data remains in LanceDB.

## Access boundary

The gateway requires Cloudflare's platform-authenticated `ctx.access` for the configured application audience and a user identity. Browser-supplied identity headers grant no access. Invited users may open/join a ready run; only the owner can request stop. Startup is disabled until provider readiness passes. A stop response says shutdown is **unconfirmed**, because this slice only persists intent.

API forwarding uses an HMAC envelope tied to the verified visitor, method, encoded target, body digest, timestamp and fresh nonce. Browser cookies/tokens never forward to the GPU. The [shared origin](../../docs/HOSTED_DEMO.md) verifies the envelope and separates visitor LanceDB state. Thirty-one origin/queue tests and ten gateway tests supplement the original 26 policy/storage tests, including ten signed HTTP clients. Gateway identity fixtures exercise authorization logic; only a real Access deployment can prove sign-in/invitation configuration.

This design uses a Worker without a Static Assets binding: the current platform does not pass `ctx.access` through the internal assets router. The eventual frontend must come through the protected origin, or use separately verified JWT validation if that routing changes. [Cloudflare Access context and limitations](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations)

## Gates still open

Alarms persist a **shutdown intent**; no provider deletion occurs. Real termination/retries, an independent cleanup fallback, account/free-plan eligibility, deployed invitation/access and direct-origin checks, frontend/runtime packaging, quote/billing integration and Free-tier CPU/quota measurements remain unverified. Local signature/workspace tests do not establish a provider spending guarantee or deployed multiuser service.

Tooling is pinned to the Miniflare beta used by Wrangler 4.152.0, with its official v4 configuration converter. The root lockfile overrides only the emulator's HTTP dependency to patched Undici 7.30.1. No frontend dependency version changed. See [hosting design](../../docs/reviews/HOSTING_DESIGN.md) for deployment gates.
