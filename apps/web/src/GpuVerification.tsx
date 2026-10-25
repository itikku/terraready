import type { SystemEvidence } from "./types";

export default function GpuVerification({
  artifact,
}: {
  artifact: SystemEvidence["verification"] | undefined;
}) {
  const proof = artifact?.evidence;
  const gpu = proof?.gpu_test;
  return (
    <section className="system-section" aria-labelledby="gpu-heading">
      <span className="eyebrow">
        HISTORICAL PRIVATE TEST · NOT LIVE HOSTING
      </span>
      <h2 id="gpu-heading">Private single-GPU integration</h2>
      {!gpu || !proof ? (
        <div className="system-unmeasured">
          <h3>
            {artifact?.status === "invalid"
              ? "GPU artifact invalid · not measured here"
              : "GPU evidence not measured here"}
          </h3>
          <p>
            No cloud results are inferred from the native test or live probe.
          </p>
        </div>
      ) : (
        <div aria-label="Recorded private GPU verification">
          <div className="system-measurement-header">
            <div>
              <h3>
                {gpu.gpu_count} × {gpu.gpu_name}
              </h3>
              <p>
                {gpu.gpu_vram_mib.toLocaleString("en-US")} MiB device memory ·{" "}
                {gpu.region} · driver {gpu.driver_version}
              </p>
              <p>
                {proof.cases.filter((c) => c.passed).length}/
                {proof.cases.length} real smoke cases · {gpu.warm_passed}/
                {gpu.warm_request_ms.length} warm requests passed.
              </p>
            </div>
            <p>
              {gpu.cleanup_verified
                ? "Temporary Pod terminated · cleanup verified"
                : "Cleanup unverified"}
            </p>
          </div>
          <ul className="system-case-grid">
            <li>
              <span className="eyebrow">BOUNDED API SAMPLE</span>
              <h3>
                p50 {(gpu.warm_p50_ms / 1000).toFixed(2)}s · p95{" "}
                {(gpu.warm_p95_ms / 1000).toFixed(2)}s
              </h3>
              <p>
                {gpu.warm_request_ms.length} end-to-end API requests;
                nearest-rank percentiles, not a reliability benchmark.
              </p>
              <small>
                Stack ready after preload: {gpu.stack_ready_seconds.toFixed(2)}
                s. First inference: {(gpu.first_request_ms / 1000).toFixed(2)}s.
                OS caches not controlled.
              </small>
            </li>
            <li>
              <span className="eyebrow">SAMPLED MEMORY</span>
              <h3>
                {gpu.sampled_peak_gpu_mib.toLocaleString("en-US")} MiB GPU peak
              </h3>
              <p>
                {(gpu.sampled_peak_container_memory_bytes / 2 ** 30).toFixed(2)}{" "}
                GiB container peak, including caches.
              </p>
              <small>
                {gpu.resource_sample_count} samples at nominal{" "}
                {gpu.sample_interval_seconds}s intervals; not absolute
                high-water marks.
              </small>
            </li>
            <li>
              <span className="eyebrow">REAL FAILURE & REVIEW</span>
              <h3>
                Full-stack journey:{" "}
                {gpu.browser_journey_passed ? "passed" : "failed"}
              </h3>
              <p>
                Stopped-model fallback:{" "}
                {gpu.model_outage_passed ? "passed" : "failed"}. Evidence
                expiry: {gpu.evidence_expiry_passed ? "passed" : "failed"}.
              </p>
              <small>
                Restart probe:{" "}
                {gpu.restart_probe_passed ? "recovered" : "failed"}. Operating
                snapshot{" "}
                {gpu.operating_snapshot_unchanged
                  ? "unchanged by analysis"
                  : "changed"}
                .
              </small>
            </li>
          </ul>
          {gpu.billing_status === "pending" &&
            gpu.observed_balance_decrease_usd !== null && (
              <p>
                Observed account balance decrease: $
                {gpu.observed_balance_decrease_usd.toFixed(2)}. Detailed Pod
                billing is still pending.
              </p>
            )}
          <p>
            {gpu.billing_status === "recorded" &&
            gpu.provider_charge_usd !== null
              ? `Provider-recorded charge: $${gpu.provider_charge_usd.toFixed(4)}. Usage ceiling: $${gpu.usage_ceiling_usd}.${gpu.provider_charge_usd > gpu.usage_ceiling_usd ? " Budget exceeded." : ""}`
              : "Final provider charge pending reconciliation; no zero-cost claim. Usage ceiling: $5."}
          </p>
          <details className="system-provenance">
            <summary>GPU source, allocation and cleanup provenance</summary>
            <dl>
              <dt>Source bundle commit</dt>
              <dd>{proof.source_base_commit}</dd>
              <dt>Image SHA-256</dt>
              <dd>{gpu.container_image_sha256}</dd>
              <dt>Allocation</dt>
              <dd>
                {gpu.allocated_vcpu} vCPU reported; {gpu.cpu_quota_cores} CPU
                quota. {(gpu.container_memory_limit_bytes / 2 ** 30).toFixed(2)}{" "}
                GiB container memory limit.
              </dd>
              <dt>Services aggregate RSS peak</dt>
              <dd>
                {gpu.sampled_services_rss_kib.toLocaleString("en-US")} KiB;
                sampled, shared pages can be double-counted.
              </dd>
              <dt>Created / terminated (UTC)</dt>
              <dd>
                {gpu.started_at} / {gpu.terminated_at}
              </dd>
              <dt>Model / runtime</dt>
              <dd>
                {proof.model.model_id} · llama.cpp {proof.model.runtime_tag} ·{" "}
                {proof.model.runtime_commit}
              </dd>
              <dt>Model SHA-256</dt>
              <dd>{proof.model.weights_sha256}</dd>
            </dl>
          </details>
          <ul className="system-limitations">
            {proof.limitations.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
