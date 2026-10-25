import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cpu,
  Database,
  Fingerprint,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getSystemEvidence } from "./api";
import type { SystemEvidence } from "./types";
import "./plan.css";
import "./system.css";
import GpuVerification from "./GpuVerification";

const flow = [
  [
    Database,
    "Local evidence",
    "Eight typed LanceDB tables: site state, observations, approvals and assistant audit records.",
  ],
  [
    Cpu,
    "Bounded assistance",
    "A small local model chooses a focused read view, checks candidates and cites stored evidence.",
  ],
  [
    ShieldCheck,
    "Independent rules",
    "Ground, freshness, prerequisites and combined resource budgets remain deterministic.",
  ],
  [
    Fingerprint,
    "Human approval",
    "A superintendent reviews the exact snapshot-bound selection; changed plans require new review.",
  ],
  [
    Users,
    "Local briefs",
    "Role-specific updates are saved and copied locally. No messages or machinery are dispatched.",
  ],
] as const;
const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function SystemPage() {
  const [data, setData] = useState<SystemEvidence | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    getSystemEvidence(c.signal)
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  const proof = data?.verification.evidence;
  const gpu = data?.gpu_verification?.evidence?.gpu_test;
  return (
    <div className="system-page">
      <a href="#system-main" className="skip-link">
        Skip to system details
      </a>
      <header className="topbar">
        <a href="/" className="wordmark system-brand">
          terra<span>ready</span>
          <span className="product-label">SYSTEM & DEPLOYMENT</span>
        </a>
        <nav aria-label="System navigation">
          <a href="/">Workspace</a>
          <a href="/system" aria-current="page">
            System
          </a>
        </nav>
      </header>
      <main id="system-main" className="system-main" tabIndex={-1}>
        <a className="system-back" href="/">
          <ArrowLeft size={15} /> Back to the site
        </a>
        <section className="system-intro" aria-labelledby="system-title">
          <span className="eyebrow">THE DESIGN BEHIND THE DECISION</span>
          <h1 id="system-title">
            Local intelligence.
            <br />
            Explicit boundaries.
          </h1>
          <p>
            Physical AI is more than deciding where a vehicle can drive. The
            useful question here is what work can still happen—and what
            evidence, resources and human decisions it needs.
          </p>
          <span className="system-label">
            THROWAWAY POC · SYNTHETIC OPERATING DATA · NOT SAFETY-CERTIFIED
          </span>
        </section>
        <section aria-labelledby="flow-heading" className="system-section">
          <h2 id="flow-heading">From observation to an accountable plan.</h2>
          <ol className="system-flow">
            {flow.map(([Icon, title, text], i) => (
              <li key={title}>
                <span className="system-step">
                  <Icon size={23} />
                  <small>0{i + 1}</small>
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
                {i < flow.length - 1 && (
                  <ArrowRight
                    className="flow-arrow"
                    size={17}
                    aria-hidden="true"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
        <section
          aria-labelledby="status-heading"
          className="system-section system-status"
        >
          <div className="system-section-heading">
            <div>
              <span className="eyebrow">LIVE CHECK · NOT A BENCHMARK</span>
              <h2 id="status-heading">What is available right now?</h2>
            </div>
            <button
              className="secondary-button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Refresh local status
            </button>
          </div>
          {!data && !error && (
            <p role="status">
              Checking local data, runtime identity and recorded evidence…
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {data && (
            <div className="system-live-grid">
              <article>
                <span className="eyebrow">SITE SNAPSHOT</span>
                <h3>
                  {data.data_ready
                    ? "Local data ready"
                    : "Local data unavailable"}
                </h3>
                <p>
                  {data.data_ready
                    ? "A validated local snapshot is readable. This is not a live sensor feed."
                    : "Stop the API and seed the demo. System details remain accessible."}
                </p>
              </article>
              <article>
                <span className="eyebrow">MODEL SERVICE</span>
                <h3>
                  {data.runtime.mode === "test_stub"
                    ? data.runtime.reachable
                      ? "Protocol stub reachable"
                      : "Protocol stub unavailable"
                    : data.runtime.reachable
                      ? "Local runtime reachable"
                      : "Local runtime unavailable"}
                </h3>
                <p>
                  {data.runtime.mode === "test_stub"
                    ? "TEST STUB — no real inference is established by this service."
                    : data.runtime.reachable
                      ? "The configured model answered an authenticated model-list request. No inference was run by this page."
                      : "Start the local model service to use assistance. Rules and manual review remain available; no cloud fallback."}
                </p>
                <small>
                  {data.runtime.model_id} · checked{" "}
                  {date(data.runtime.checked_at)} Pacific
                </small>
              </article>
            </div>
          )}
        </section>
        <section
          aria-labelledby="evidence-heading"
          className="system-section"
          id="verification"
        >
          <span className="eyebrow">
            HISTORICAL EVIDENCE · SEPARATE FROM LIVE STATUS
          </span>
          <h2 id="evidence-heading">What has actually been tested?</h2>
          {!proof ? (
            <div className="system-unmeasured">
              <h3>
                {data?.verification.status === "invalid"
                  ? "Verification artifact invalid · not measured here"
                  : data?.verification.status === "missing"
                    ? "Verification artifact missing · not measured here"
                    : "Verification evidence not loaded"}
              </h3>
              <p>
                No sample timings or green validation badges are substituted. A
                valid, sanitized completed test artifact is required.
              </p>
            </div>
          ) : (
            <div aria-label="Recorded real-model verification">
              <div className="system-measurement-header">
                <div>
                  <span className="system-label">
                    RECORDED LOCAL-MODEL SMOKE
                  </span>
                  <h3>
                    {proof.cases.filter((c) => c.passed).length} of{" "}
                    {proof.cases.length} task checks passed
                  </h3>
                  <p>
                    {proof.hardware.host} · {proof.hardware.architecture}
                    {proof.hardware.host_memory_bytes
                      ? ` · ${proof.hardware.host_memory_bytes / 2 ** 30} GiB host RAM`
                      : " · host RAM not reported"}
                  </p>
                </div>
                <p>
                  Recorded {date(proof.recorded_at)} Pacific.
                  <br />
                  Not a guarantee about the running service.
                </p>
              </div>
              <ul className="system-case-grid">
                {proof.cases.map((c) => (
                  <li key={c.name}>
                    <span className="eyebrow">{c.name.toUpperCase()}</span>
                    <h3>
                      {c.passed ? "Passed" : "Failed"} ·{" "}
                      {(c.elapsed_ms / 1000).toFixed(1)}s
                    </h3>
                    <p>{c.tools.join(" → ")}</p>
                    <small>Evidence: {c.evidence_ids.join(", ")}</small>
                  </li>
                ))}
              </ul>
              <details className="system-provenance">
                <summary>
                  Exact model, source and measurement provenance
                </summary>
                <dl>
                  <dt>Model</dt>
                  <dd>
                    {proof.model.model_id} · {proof.model.license}
                  </dd>
                  <dt>Model revision</dt>
                  <dd>{proof.model.revision}</dd>
                  <dt>Weights SHA-256</dt>
                  <dd>{proof.model.weights_sha256}</dd>
                  <dt>Runtime</dt>
                  <dd>
                    llama.cpp {proof.model.runtime_tag} ·{" "}
                    {proof.model.runtime_commit}
                  </dd>
                  <dt>Launch configuration</dt>
                  <dd>
                    {proof.hardware.gpu_layers_requested} GPU layers requested ·{" "}
                    {proof.hardware.cpu_threads} CPU threads ·{" "}
                    {proof.hardware.context_size} context. Not a VRAM
                    measurement.
                  </dd>
                  <dt>Host OS</dt>
                  <dd>{proof.hardware.os}</dd>
                  <dt>Dataset SHA-256</dt>
                  <dd>{proof.dataset_sha256}</dd>
                  <dt>Source base commit</dt>
                  <dd>
                    {proof.source_base_commit} ·{" "}
                    {proof.working_tree_dirty
                      ? "Working tree had changes; exact source-file hashes recorded below."
                      : "Clean working tree at capture."}
                  </dd>
                  {Object.entries(proof.source_sha256).map(([path, hash]) => (
                    <div className="system-hash" key={path}>
                      <dt>{path}</dt>
                      <dd>{hash}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <p>Limits of the native smoke above:</p>
              <ul className="system-limitations">
                {proof.limitations.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <GpuVerification artifact={data?.gpu_verification} />
        <section
          aria-labelledby="boundaries-heading"
          className="system-section"
        >
          <h2 id="boundaries-heading">What the model cannot decide.</h2>
          <div className="system-decision-grid">
            <article>
              <h3>Facts live outside the model.</h3>
              <p>
                Typed LanceDB records carry units, timestamps, completion and
                references. Real aerial context and the synthetic inspection
                illustration do not establish soil measurements. No image
                embeddings or visual inference are implemented.
              </p>
            </article>
            <article>
              <h3>Uncertainty stays a hold.</h3>
              <p>
                Stale or conflicting evidence requires inspection. Unfinished
                prerequisites and combined capacity remain hard gates. Model
                outputs cannot turn these into a go decision.
              </p>
            </article>
            <article>
              <h3>Tools are deliberately small.</h3>
              <p>
                Focused shift read, stored evidence, candidate checks and a
                structured conclusion only. Five responses, 960 completion
                tokens and a 120-second turn deadline. No shell, SQL, arbitrary
                URL, approval or dispatch tools.
              </p>
            </article>
            <article>
              <h3>Failure preserves manual control.</h3>
              <p>
                Missing inference, timeout or invalid references produce a
                labeled rules-only fallback. Every approval recomputes
                constraints and the snapshot fingerprint. Approval does not
                complete work, authenticate a supervisor or control machinery.
              </p>
            </article>
          </div>
        </section>
        <section
          aria-labelledby="deployment-heading"
          className="system-section"
        >
          <h2 id="deployment-heading">Implemented. Designed. Measured.</h2>
          <div className="system-deployment-grid">
            <article>
              <span className="system-label">IMPLEMENTED HERE</span>
              <h3>Local-first work recovery</h3>
              <p>
                Local imagery/fonts, eight typed tables, deterministic checks,
                optional local inference and human-approved briefs. Mapbox is
                opt-in presentation infrastructure, not a planning dependency.
              </p>
            </article>
            <article>
              <span className="system-label">DESIGNED FOR EDGE</span>
              <h3>A self-contained workload</h3>
              <p>
                Preload data, dependencies and weights on one host. Keep model
                authority bounded and manual review usable. Portability is a
                design choice—not proof of a particular device's memory, power
                or latency envelope.
              </p>
            </article>
            <article>
              <span className="system-label">HARDWARE EVIDENCE</span>
              <h3>
                {gpu?.gpu_name || proof?.hardware.host || "Not measured here"}
              </h3>
              <p>
                {gpu
                  ? "The separate native smoke and private single-GPU test are recorded above. The cloud Pod was temporary; this is not Jetson or power-efficiency validation."
                  : proof
                    ? "Only the recorded local smoke above. CPU-only 4B inference hit the 120-second deadline on the M1 trial; Metal is the native default. This is not Jetson validation."
                    : "No valid artifact loaded. No hardware pass is inferred from the architecture."}
              </p>
            </article>
          </div>
          <div className="system-unmeasured">
            <h3>Not measured yet</h3>
            <ul>
              {!gpu && (
                <li>
                  Private cloud-GPU integration and observed provider charges
                  are not established by a native artifact.
                </li>
              )}
              {gpu?.billing_status === "pending" && (
                <li>Final provider charges: reconciliation pending.</li>
              )}
              <li>
                Full-stack external-access denial after preload is deferred and
                unverified. A runtime offline flag or blocked browser requests
                alone is not that proof.
              </li>
              <li>
                {gpu
                  ? "Power and production reliability."
                  : "Peak workload RAM/VRAM, power, latency percentiles and production reliability."}
              </li>
              <li>Jetson: not deployed and not planned for this POC.</li>
            </ul>
          </div>
        </section>
        <footer className="system-footer">
          <p>
            Construction is implemented. Agriculture, mining and forestry share
            the task × asset × place × evidence decision boundary as a
            cross-vertical thesis—not three additional working products.
          </p>
          <a href="/">
            Return to the operating decision <ArrowRight size={15} />
          </a>
        </footer>
      </main>
    </div>
  );
}
