# Current project state

Updated: 2026-10-25. Active slice: **Phase 7 — private GPU readiness / access gate**. Phases 5–6 verified.

## What works

- Local React/Vite evidence workspace, attributed real NAIP aerial, synthetic operating layers/inspection illustration, optional Mapbox with local fallback.
- Pure ground rules and seven-package v2 recovery: actual completion/prerequisites, paired-resource capacity, haul reroute, ready-yard pull-forward, west successor held.
- Fingerprint-bound, idempotent local approval and role-specific copy/export. Approval never completes work or dispatches anything.
- Genuine Qwen3-4B Q4_K_M / llama.cpp assistance. Model first chooses `get_shift(focus)`; server narrows/fixes the view and requires candidate checking before concluding when options exist. Known-ID schemas plus independent final checks; displayed operational facts come from rules, not model prose.
- Five-response / 960-completion-token / 120-second limits, authenticated fixed-loopback transport, no cloud fallback or write/approval/shell/SQL/URL tools. Invalid/unsafe output, timeout or unavailable/busy runtime produces explicit deterministic fallback.
- Eight typed LanceDB tables including nested assistant audit facts/trace/timings. No retained questions, arbitrary rejected arguments, model prose/reasoning or credentials. Audit-save failure is labeled.
- Assistant panel: cited facts/trace → exact-subset review → explicit human approval → copy teammate updates. Holds/deferred work, resource budgets and deadline visible. Full shift-first redesign remains deferred.
- Direct `/system` page and read-only `/api/system`: live data/runtime identity probe separated from typed historical measurements; missing/corrupt/incomplete/stub artifacts are not substituted with fake metrics. Dataflow, model/constraint/approval boundaries, edge intent and unmeasured hardware/network/cost limits are explicit.

## Latest verification

- **Latest `caffeinate -is make verify` passed**: backend format/lint/strict types; **245 tests, 99.40% statement/branch coverage** (100% agent/ground/recovery/domain/API/transport/system-evidence); frontend format/types/lint/build; **41 browser tests (1.2m)**, unchanged map baseline, mobile/keyboard and zero tested axe violations. Includes 9 System-page tests for navigation/deep-link/back, unavailable/stub runtime, loading/error/retry, invalid/missing artifacts and mobile provenance.
- Browser assistant tests use an authenticated HTTP **test_stub**, visibly labeled. Cover review/approval/reload/copy, backlog/holds, outage/malformed output, cancellation/retry, stale snapshot, failed save, expiry and audit failure. Not inference benchmarks.
- **Real-model smoke: 3/3 passed**, unchanged criteria: reroute **19,137ms**, backlog/redeploy **17,060ms**, blocked prerequisite + stored evidence **11,926ms**. Apple M1 / 8 GiB, Metal 99 layers, 2 CPU threads, 4096 context, one slot. Three cases are not a reliability or percentile benchmark.
- Refreshed real-model artifact for Phase 6 also **3/3 passed**: **24,843 / 30,221 / 13,270ms**, respectively. Includes actual sysctl M1/8 GiB host metadata, exact current source hashes, runtime launch configuration and honest base-commit/dirty-state provenance. Public typed projection is tracked in `docs/verification/local-agent.json`; it excludes questions, raw output, credentials and private filesystem paths. Runtime environment hardening was active during this refresh.
- Actual API **200**, `local_model`, redeploy, LanceDB audit saved, **21,290ms**; `get_shift → evaluate_candidates → finish_analysis`. Operating snapshot unchanged; no approval/dispatch.
- Live `make smoke` passed ground outcomes, 7-package recovery and selection revalidation. Whitespace and ignored token/key/weights checks pass. Desktop/mobile assistant screenshots inspected.
- Phase 6 live HTTP: `/system` serves 200; `/api/system` reports data ready, runtime unreachable while stopped, and 3 historical real-model passes independently. System desktop/mobile artifacts inspected; provenance fields wrap without horizontal overflow.
- After restoring the actual model, the same live endpoint reports `reachable=true`, `mode=local_model`, historical artifact still recorded, without triggering inference. Final live `make smoke` passes unchanged.
- Lazy Mapbox bundle advisory unchanged. GitHub CI configured but not remotely run; no remote repo/public deployment exists.
- Prior results/failures: `VERIFICATION_HISTORY.md`. Actual sanitized report: ignored `.data/reports/local-agent.json`, with runtime/model/dataset/source hashes, base commit + dirty-state provenance and step timings. Failed attempts retained. Export a validated artifact for Phase 6, never invented metrics.

## Decisions and limits

- One synthetic construction site / 3 equipment-operator pairs / 7 packages. No workforce system, optimal/timed scheduler or measured savings.
- Real aerial context does not establish soil conditions. No image embeddings, similarity retrieval or visual inference yet.
- Qwen3-1.7B Q8_0 failed relevance/reference acceptance despite real tool calls. Second/final candidate is 4B Q4_K_M. Focus-first context + staged tools fixed the unchanged smoke; no silent extra models/cloud fallback.
- 4B CPU trial timed out at **120,081ms** on rerouting; other CPU cases interrupted. Launcher defaults to Metal; CPU explicit `--gpu-layers 0`. No CPU-real-time, Jetson or cloud-GPU claim.
- Manifest: `config/local-model.json`; official Apache-2.0 revision `bc640142c66e1fdd12af0bd68f40445458f3869b`, weights SHA-256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`. llama.cpp b11669 / commit 620d2225c. Setup/security: `LOCAL_AGENT.md`.
- Loopback-only, single-process POC. No authenticated superintendent or public hosting. Runtime offline flag/browser blocking are NOT full-stack egress-denial proof.
- Private temporary Runpod GPU test approved with **$5 cumulative usage ceiling**. Larger deposit/budget, payment details or public exposure require approval. User has no account yet; wait until deployment-ready. No paid resources/spend.
- Autonomous continuation/routine gates approved while user away. Stop for genuinely missing authority/access or material ambiguity, not routine steps. UI tuning deferred.

## Services and recovery

- Keep Chrome **http://localhost:5173/** and **http://localhost:5173/system** available. Vite session **21104**; API session **30583**, port 8000, latest System endpoint loaded.
- Actual model running in session **28048** after full QA: `make model`, Metal default, authenticated loopback 8080; owner-only ignored `.data/runtime/inference.key`. Real authenticated reachability verified. Scope `caffeinate -is` to checks, not long-lived servers.
- Tests: independent `.data/e2e-lancedb`, ports 5174/8001/8082. Never reset manual DB. Upgrade backup: `.data/backups/pre-shift-contract-lancedb-20261024/`.
- Never read/print/copy/upload/commit `.env.local` (Mapbox token). Model/runtime/data ignored. Docker daemon unavailable; do not start globally.

## Single next step

Phase 5 backend **3ba7798**, UI **b647a33**, captures/state **77af88c**. Commit verified Phase 6, then finish only safe private-GPU readiness preparation: verify provider pricing/deposit and network-isolation capabilities from primary sources, prepare secret-free pinned workload/test/cleanup instructions, and stop at the actual account/quote/authority gate. No provisioning, funding, public exposure or external writes without that gate. User offered to create Runpod account when needed; no credentials should be pasted in chat. Full-stack external-access denial must be genuine, not browser-only blocking or a runtime flag.
