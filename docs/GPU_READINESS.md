# Private GPU test — readiness and authority gate

Checked 2026-10-25. **No paid resource, deposit, account mutation or public deployment has occurred.** This is a gate record, not a tested deployment runbook.

## Local prerequisites achieved

- Phase 5 real local-model assistance and Phase 6 system/evidence page are committed through `d01211e`.
- Full verification: 245 backend tests / 99.40% statement-branch coverage, frontend checks/build and 41 browser tests pass.
- Actual M1/Metal inference passed reroute, backlog/redeployment and blocked-prerequisite/evidence checks. A real API request saved a typed audit without changing the operating snapshot.
- Runtime availability is separately probed; hardware/source/model/dataset evidence is sanitized and versioned. Missing or invalid artifacts are never replaced with sample measurements.

## Funding and instance selection

The user approved a **$5 cumulative test-usage ceiling**; a larger upfront deposit requires separate approval.

[Runpod billing documentation](https://docs.runpod.io/accounts-billing/billing) describes non-refundable prepaid credits and a $10 starting amount. It also requires enough balance for one hour of the selected configuration. The account's actual checkout minimum has not been inspected: no account exists yet. Do not assume a custom $5 payment will be accepted, and do not fund $10 without approval. Leave auto-pay disabled.

[Public pricing](https://www.runpod.io/pricing), checked 2026-10-25, lists A5000 24 GB at $0.27/hour and L4 24 GB at $0.59/hour. These are reference prices, **not an available-instance quote or total test cost**. Confirm the exact instance, compute/storage charges, taxes and deposit in the account before provisioning. Do not substitute a larger GPU automatically.

[Pod pricing/storage documentation](https://docs.runpod.io/pods/pricing) distinguishes running container storage from persistent volumes and continued stopped-volume charges. Prefer temporary container disk for this throwaway test, export results before termination and verify no residual billable resources. The provider's default hourly limit is not our $5 cumulative ceiling; use an independent deadline/cleanup path and monitor actual charges with margin.

## Access and offline-proof requirements

- Use authenticated private access. [Runpod's SSH documentation](https://docs.runpod.io/pods/configuration/use-ssh) distinguishes proxied basic SSH from full SSH/public-IP access and recommends key authentication. Confirm tunneling/file-transfer capabilities for the exact instance; do not assume basic SSH supports every workflow.
- Keep application/API/model services bound to loopback. No public unauthenticated HTTP proxy. Use a new remote inference key; never copy the local model key or Mapbox `.env.local`.
- Upload only an explicit secret-free source/assets allowlist. No local databases, credentials, `.env*`, model/runtime caches or browser profiles. Preload pinned dependencies/weights before the network-isolation test.
- Runpod's [container-isolation description](https://docs.runpod.io/references/security-and-compliance) is **not** evidence that this workload can enforce outbound denial. Kernel/platform network controls, required privileges, actual external-probe failure and independent SSH/provider cleanup must be verified. Do not assume root implies network-administration privileges, and do not substitute browser request blocking, proxy variables or `--offline` for full-stack proof.
- Linux/CUDA packaging has not been built/tested; the current verified runtime is native macOS. Docker's local daemon is unavailable and must not be started globally. Pin and verify the actual Linux/CUDA runtime/container before presenting a deploy command as ready.

## Before any paid run

1. Human confirms account access and whether up to $10 of non-refundable starting credits is acceptable, while retaining the $5 usage ceiling. No credentials in chat.
2. Read-only inspection confirms actual quote, minimum, private-access method and isolation-control feasibility. If any material tradeoff changes, ask; do not weaken acceptance criteria silently.
3. Prepare and verify pinned workload packaging, preloading, true egress-denial controls/probes, browser journey, timing/memory report and cleanup commands. Record exact resource identifiers only after creation.
4. Approve the identified runtime/spend/deadline envelope, then provision just one temporary resource. Fail early if isolation/private-access prerequisites are absent; preserve control/cleanup access.
5. Export sanitized results, terminate that exact resource and remove only its unneeded storage; confirm final charges and absence of remaining billable resources.

Next user decision: create the Runpod account without funding/deploying, and approve or decline a potential $10 prepaid deposit. The local Chrome demo remains usable regardless.
