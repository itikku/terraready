# Shared-demo controller readiness

This is the local budget/deadline proof for the approved Cloudflare Free design. It is **not a deployed service**. Every public Worker request returns 503. There is no Runpod client, credential, invitation flow, app proxy or live provisioning code.

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

The internal `apply` binding accepts trusted server events only; timestamps come from the controller. A future authenticated gateway must never pass arbitrary browser events or quote/billing inputs through to it. Domain data remains in LanceDB.

## Gates still open

Alarms persist a **shutdown intent**; no provider deletion occurs. Real termination/retries, an independent cleanup fallback, account/free-plan eligibility, invitation/JWT and direct-origin protection, per-visitor workspaces, build/provenance, quote/billing integration and Free-tier CPU/quota measurements remain unverified. Passing these tests does not establish a provider spending guarantee.

Tooling is pinned to the Miniflare beta used by Wrangler 4.152.0, with its official v4 configuration converter. The root lockfile overrides only the emulator's HTTP dependency to patched Undici 7.30.1. No frontend dependency version changed. See [hosting design](../../docs/reviews/HOSTING_DESIGN.md) for deployment gates.
