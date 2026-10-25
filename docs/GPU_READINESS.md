# Private GPU test — readiness and authority gate

Checked 2026-10-25. **No paid resource, deposit, account mutation or public deployment has occurred.** This is a gate record, not a tested deployment runbook.

## Local prerequisites achieved

- Phase 5 real local-model assistance and Phase 6 system/evidence page are committed through `d01211e`.
- Full verification: 245 backend tests / 99.40% statement-branch coverage, frontend checks/build and 41 browser tests pass.
- Actual M1/Metal inference passed reroute, backlog/redeployment and blocked-prerequisite/evidence checks. A real API request saved a typed audit without changing the operating snapshot.
- Runtime availability is separately probed; hardware/source/model/dataset evidence is sanitized and versioned. Missing or invalid artifacts are never replaced with sample measurements.

## Funding and instance selection

The user approved a **$5 cumulative test-usage ceiling** and, on 2026-10-25, separately approved **up to $10 of prepaid credits if required**. The user is creating the account. A larger deposit or usage budget still requires separate approval; the agent has not funded or provisioned anything.

[Runpod billing documentation](https://docs.runpod.io/accounts-billing/billing) describes non-refundable prepaid credits and a $10 starting amount. It also requires enough balance for one hour of the selected configuration. The account's actual checkout minimum has not been inspected. Do not assume a custom $5 payment will be accepted or treat the $10 funding approval as a $10 usage allowance. Leave auto-pay disabled; the user handles any new payment details.

[Public pricing](https://www.runpod.io/pricing), checked 2026-10-25, lists A5000 24 GB at $0.27/hour and L4 24 GB at $0.59/hour. These are reference prices, **not an available-instance quote or total test cost**. Confirm the exact instance, compute/storage charges, taxes and deposit in the account before provisioning. Do not substitute a larger GPU automatically.

[Pod pricing/storage documentation](https://docs.runpod.io/pods/pricing) distinguishes running container storage from persistent volumes and continued stopped-volume charges. Prefer temporary container disk for this throwaway test, export results before termination and verify no residual billable resources. The provider's default hourly limit is not our $5 cumulative ceiling; use an independent deadline/cleanup path and monitor actual charges with margin.

## Access and offline-proof requirements

- Use authenticated private access. [Runpod's SSH documentation](https://docs.runpod.io/pods/configuration/use-ssh) distinguishes proxied basic SSH from full SSH/public-IP access and recommends key authentication. Confirm tunneling/file-transfer capabilities for the exact instance; do not assume basic SSH supports every workflow.
- Keep application/API/model services bound to loopback. No public unauthenticated HTTP proxy. Use a new remote inference key; never copy the local model key or Mapbox `.env.local`.
- Upload only an explicit secret-free source/assets allowlist. No local databases, credentials, `.env*`, model/runtime caches or browser profiles. Preload pinned dependencies/weights before the network-isolation test.
- Runpod's [container-isolation description](https://docs.runpod.io/references/security-and-compliance) is **not** evidence that this workload can enforce outbound denial. Kernel/platform network controls, required privileges, actual external-probe failure and independent SSH/provider cleanup must be verified. Do not assume root implies network-administration privileges, and do not substitute browser request blocking, proxy variables or `--offline` for full-stack proof.
- Linux/CUDA packaging has not been built/tested; the current verified runtime is native macOS. Docker's local daemon is unavailable and must not be started globally. Pin and verify the actual Linux/CUDA runtime/container before presenting a deploy command as ready.

## Runpod agent setup — installed, sign-in pending

At the user's explicit request, fetched the [official agent setup guide](https://agents.runpod.io/) and inspected the official plugin source at revision `926087d9f605645ef52b82dba1fc9714dd2da4d1`.

- Installed all 16 router/lane/journey skills with Codex's skill installer, pinned to that revision. The Python download route failed certificate verification; the installer's Git route succeeded without disabling TLS verification. No global Node upgrade was made (normal Node is 22.12.0; bundled Node 24.22.1 exists).
- Registered the official marketplace at the inspected revision and installed **`runpod@runpod` 1.8.0**. `codex plugin list --marketplace runpod --json` confirms installed/enabled.
- `codex mcp get runpod --json` confirms the plugin's HTTP connection is registered/enabled at **`https://mcp.getrunpod.io/`**, with no manually configured bearer/header. This is the URL in the inspected official plugin; do not register a duplicate server merely because the setup page names `mcp.runpod.io`.
- The active session has no Runpod tools yet. Per the setup guide, the human must fully quit/reopen the desktop app, then complete **Sign in with Runpod** in the browser. Installation/registration is not authenticated access. After sign-in, verify with a real **read-only list of Pods**; an empty list is a valid result, not evidence of the wrong account merely because credits exist.
- Follow the requested setup guide's OAuth route. The router skill also recommends an API key for CLI work; that does not authorize asking for a key in chat or installing extra CLIs now. `runpodctl`, Flash, new API keys and paid resources were not installed/created. If a later required operation genuinely needs CLI authentication, address that separately.
- No account inventory, balance, actual instance quote or account-side isolation control has been read. No payment, provider resource, public endpoint or upload was made. No documentation-feedback submission was sent; setup does not require exporting project/session information.

This turn changed installation/configuration and repository documentation only, not application code. Existing application test results remain the last recorded results, not a newly rerun suite. The planned source-bundle slice was interrupted by setup and has **not** been implemented.

## Before any paid run

1. Funding authority is recorded: up to $10 of prepaid credits if required, usage capped at $5. Human confirms account access when ready; no credentials in chat.
2. Read-only inspection confirms actual quote, minimum, private-access method and isolation-control feasibility. If any material tradeoff changes, ask; do not weaken acceptance criteria silently.
3. Prepare and verify pinned workload packaging, preloading, true egress-denial controls/probes, browser journey, timing/memory report and cleanup commands. Record exact resource identifiers only after creation.
4. Approve the identified runtime/spend/deadline envelope, then provision just one temporary resource. Fail early if isolation/private-access prerequisites are absent; preserve control/cleanup access.
5. Export sanitized results, terminate that exact resource and remove only its unneeded storage; confirm final charges and absence of remaining billable resources.

Current next step: human restarts the desktop app and signs in; verify read-only Pod access before relying on the connection. Then resume source-bundle/Linux readiness work and inspect account-specific quote/private access/isolation capabilities. Do not start a GPU or enable public HTTP endpoints before those gates. After restart, check/restart the local preview services if needed; restarting the app is not evidence that they survived.
