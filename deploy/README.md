# Prebuilt demo runtime

The reviewed image builds the app once on a standard GitHub Linux runner. A GPU
session starts the packaged app and pinned local model without installing tools,
building the frontend or downloading weights. The image still has to be pulled
onto its host. The first uncached L4 start took 175.834 seconds, dominated by that
pull; services were ready about five seconds after container start. See the
[measured scope and cleanup](../docs/HOSTED_DEMO.md#packaged-runtime-observation):
this does not establish a substantial cold-start improvement.

## Build and release gate

1. Commit a coherent, locally verified source revision. The CPU image build may run
   alongside normal CI; both must succeed before enabling the artifact in the demo.
2. Manually run **Build reviewed demo runtime** (`runtime-image.yml`) at that exact
   revision. The workflow prepares the existing source-only allowlist bundle;
   it never sends the local checkout, environment or database to Docker.
3. Inspect its `runtime-image-identity` artifact and build log. The build checks
   source provenance, downloaded checksums, CUDA library linkage and built assets.
   Its CPU inspection does not establish GPU compatibility or successful inference.
4. On first publication, make only `ghcr.io/itikku/terraready-runtime` public in
   GitHub package settings and verify an anonymous manifest pull. GitHub packages
   start private even when the source repository is public. No Runpod registry key
   or personal access token is needed for an anonymously readable image.
5. Bind `IMAGE_REF=ghcr.io/itikku/terraready-runtime@sha256:<verified digest>` and
   its matching full `SOURCE_COMMIT` in the existing controller. Preserve the source
   archive SHA pin, encrypted secrets, durable ledger and current live session.
   The pin applies only to subsequent starts. Invalid image names/digests fail closed.

The build job uses only `contents: read` and `packages: write` on the temporary
repository `GITHUB_TOKEN`. Pushing a new workflow may require adding the `workflow`
scope to the existing GitHub CLI connection; package-publishing PATs, billing changes
and new Runpod scopes are unnecessary. There is no scheduled build or GPU launch.

## Runtime contract

- Linux amd64, Python 3.12.12 slim on Debian Trixie at a pinned image digest, locked Python packages
  and frontend, existing checksum-pinned Qwen3-4B Q4_K_M/llama.cpp CUDA 12.8 assets.
- Only the required pinned NVIDIA cuBLAS 12.8.4.1 and cudart 12.8.90 wheels are added;
  PyTorch, Jupyter and the full CUDA development toolkit are absent. NVIDIA wheel
  license files are retained; Qwen remains Apache-2.0 and original source MIT.
- The pinned llama CUDA binary requires `GLIBC_2.38`. Trixie's glibc 2.41 satisfies
  that ABI requirement; Bookworm's 2.36 does not. Image builds check both server
  and CUDA-library linkage before downloading weights, and fail on missing
  libraries or symbol versions. Only the exact host-provided `libcuda.so.1`
  absence is allowed on the CPU build runner. Diagnostics expose bounded library
  and version names, never raw paths or environment values.
- One GPU, existing 50 GB ephemeral disk and port 8000, with inference on loopback
  8080. New runtime keys and synthetic workspaces are created per disposable run.
- `scripts/hosted_image.py run` discards the injected provider management key before
  reading child environments, verifies source identity/frontend hashes, and refuses
  to reset a reused workspace. The launcher verifies model and runtime member hashes.
- The signed `/startup` route returns only an enum and transition time. It uses the
  existing HMAC/replay envelope and does not create a visitor workspace. `/ready`
  cannot succeed during model loading. The controller persists observed startup
  states without extending a usage, idle, setup or cost deadline. Readiness is
  checked every five seconds during startup, avoiding the old thirty-second wait
  between checks; cleanup retry timing remains unchanged.
- Before the signed app can answer, the page says that the GPU environment is
  downloading or starting. Later it can show model loading and workspace checks.
  The elapsed timer explicitly measures total startup. There are no invented
  percentages or claims about unobserved provider image-pull progress.

The prebuilt artifact is enabled for new sessions after CPU build, anonymous pull
and one real GPU integration check. `scripts/hosted_boot.py` remains the previously
verified source-download baseline. Removing `IMAGE_REF` is an explicit operator
rollback, not an automatic fallback that can silently change the runtime.
