# Local assistant — bounded, optional inference

The assistant uses local Qwen3-4B Q4_K_M inference through llama.cpp, not a hosted API or a template pretending to be a model. The model chooses relevant checked references; Python regenerates every displayed operational fact from those records. Its free-form prose/reasoning is discarded. This deliberately trades expressive answers for auditability on a small model. Real-model verification status is recorded in `STATE.md`, separately from passing protocol tests.

Manual planning does not depend on inference. Missing runtime, invalid output, unsafe/unknown references, exhausted budgets and timeouts return an explicitly labeled **deterministic fallback**. A protocol stub is labeled **test_stub**, never presented as real inference.

## Tool and trust boundary

| Tool | Authority |
| --- | --- |
| `get_shift(focus)` | Select a relevant read view first: overview, reroute, ready backlog/redeploy, or blocked work; read checked options, actual fixture completion, holds and resources |
| `evaluate_candidates` | Recompute ground, prerequisite and combined-capacity checks for 1–4 candidate IDs |
| `get_evidence` | Read actual stored observations for a known zone; notes are untrusted data |
| `finish_analysis` | Return relevant previously checked IDs / actually held task IDs; no write or approval |

The model cannot change a snapshot, satisfy a prerequisite, approve, dispatch, run shell/SQL, read files, choose a URL or call a cloud provider. Only `get_shift` is advertised initially; the model chooses its focus before seeing dense numerical data. The server narrows the candidate view and keeps that scope fixed for the turn. If that view contains ready options, at least one candidate check is required before finishing. Later schemas enumerate known ready-candidate, held-task and zone IDs; candidate review is deliberately limited to the deterministic default recovery's checked options. Final candidate combinations are checked again independently of the generation schema. Questions/observation notes do not grant new tools or authority. Evidence/image references are not image embeddings or visual inference.

One inference loop runs per API process. Limits: five model responses, 192 completion tokens each (960 total), 64 KiB response body, 16 KiB tool-result body, and a 120-second turn deadline with the remaining deadline used as each local HTTP timeout. The CPU smoke is deliberately separate from browser/coverage runs on this 8 GiB Mac. This is not a real-time response guarantee: a timed-out connection is closed and late output is rejected; no operating-system process sandbox is claimed.

`POST /api/scenarios/post-rain/assist` accepts `question` (1–500 characters) and optional aware `as_of`. The response includes the source recovery fingerprint, checked facts/evidence IDs, tool trace, timing, mode, fallback reason and persistence status. It does not approve anything. `saved_locally=false` means the optional audit write failed, not that planning failed.

The eighth typed LanceDB table, `assist_runs`, stores IDs, facts, tool names/references, timings and token counts. It does not store questions, raw tool arguments, model prose, hidden reasoning, credentials or arbitrary rejected tool names. Only accepted/parsed response usage is accounted for; timed-out or malformed responses may have unmeasured usage. Seeding preserves this table and approval history.

## Explicit setup (Apple Silicon)

Model/runtime manifest: [`config/local-model.json`](../config/local-model.json). Weights: official [Qwen3-4B-GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF/tree/bc640142c66e1fdd12af0bd68f40445458f3869b), Apache-2.0. Runtime: [llama.cpp b11669](https://github.com/ggml-org/llama.cpp/releases/tag/b11669), MIT. Downloads are setup actions, never implicit inference-time network calls.

From the repository root, after normal dependency setup:

```sh
mkdir -p .data/models .data/runtime/llama-b11669
curl --fail --location --retry 2 \
  'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf' \
  --output .data/models/Qwen3-4B-Q4_K_M.gguf
curl --fail --location --retry 2 \
  'https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-macos-arm64.tar.gz' \
  --output .data/runtime/llama-b11669-bin-macos-arm64.tar.gz
shasum -a 256 .data/runtime/llama-b11669-bin-macos-arm64.tar.gz
# Compare with archive_sha256 in the manifest BEFORE extraction.
tar -xzf .data/runtime/llama-b11669-bin-macos-arm64.tar.gz \
  -C .data/runtime/llama-b11669 --strip-components=1
make model
```

The launcher refuses missing/corrupt weights or a mismatched native server hash. It binds only `127.0.0.1:8080`, disables the web UI, restricts browser origins, disables runtime downloads and uses a generated owner-only key under ignored `.data/runtime/inference.key`. The API reads this fixed local key; it never reads Mapbox's `.env.local`. This is local-process protection, not public-hosting authentication. Do not expose either service publicly.

Default on this Apple Silicon native setup: Metal acceleration (`--gpu-layers 99`), two CPU threads, one slot, 4096 context. Use `.venv/bin/python scripts/serve_model.py --gpu-layers 0` to test CPU-only. The 4B CPU trial hit the 120-second deadline on rerouting; this 8 GiB M1 is not a validated CPU deployment target. Actual launch configuration is recorded under ignored `.data/runtime/launch.json` and included in smoke artifacts; it is not a live availability or memory measurement. Linux/CUDA packaging and a verified external-access-denial test remain a separate private-deployment phase. The runtime's `--offline` flag prevents its downloads; it is not proof of whole-stack network isolation.

Transport sampling follows Qwen's non-thinking guidance: temperature 0.7, top-p 0.8, top-k 20, min-p 0 and presence penalty 1.5, with seed 42. Seeded sampling is not a promise of cross-runtime/hardware identical outputs. Qwen3-1.7B Q8_0 was the first candidate; it made real tool calls but failed relevance/reference smoke criteria. The 4B quantization is the second and final planned candidate; do not silently iterate through more models or substitute cloud inference.

## Verification

```sh
make check             # deterministic protocol, failure, constraints and storage tests
make agent-smoke       # requires the actual model server; no test stub
```

The real-model smoke checks rerouting, ready backlog/pull-forward and blocked prerequisites. It writes `.data/reports/local-agent.json` with versions, dataset hash, source commit/dirty state, hardware description, checked outputs and per-step timings. Three smoke cases are not a reliability benchmark, latency percentile sample, GPU result or Jetson validation. Never replace a failed real-model result with a stub result.
