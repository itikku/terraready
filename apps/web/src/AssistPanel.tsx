import { useEffect, useRef, useState } from "react";
import { Cpu, ShieldCheck } from "lucide-react";
import { approveRecovery, askAssistant, reviewAssistance } from "./api";
import type { AssistRun, RecoveryPlan, Site } from "./types";
import "./assist.css";

const prompts = [
  ["Reroute", "Can we reroute the loaded hauler to keep the east haul moving?"],
  [
    "Redeploy",
    "What ready upcoming work can the excavator pull forward instead of idling?",
  ],
  [
    "Blocked work",
    "Why can't west-followup start? Read the west-stockpile evidence before explaining.",
  ],
];
const modes = {
  local_model: "Local model · rules checked",
  test_stub: "TEST STUB · not real inference",
  deterministic_fallback: "Rules-only fallback · model did not finish",
};
const localClock = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export default function AssistPanel({
  site,
  asOf,
}: {
  site: Site;
  asOf?: string;
}) {
  const [question, setQuestion] = useState(
    "What changed in today's shift, and what can we recover?",
  );
  const [run, setRun] = useState<AssistRun | null>(null);
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const taskName = (id: string) =>
    site.tasks.find((t) => t.id === id)?.name ?? id;
  async function action(kind: "ask" | "review" | "approve") {
    if (busy) return;
    const c = new AbortController();
    request.current = c;
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      if (kind === "ask") {
        setRun(null);
        setPlan(null);
        setReviewed(false);
        const result = await askAssistant(question.trim(), c.signal, asOf);
        if (!c.signal.aborted) setRun(result);
      } else if (kind === "review" && run) {
        const result = await reviewAssistance(run, c.signal, asOf);
        if (!c.signal.aborted) {
          setPlan(result);
          setReviewed(false);
        }
      } else if (
        kind === "approve" &&
        plan &&
        reviewed &&
        plan.selected_candidate_ids.length
      ) {
        const approval = await approveRecovery(plan, c.signal);
        if (!c.signal.aborted) setPlan({ ...plan, approval });
      }
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Local request failed. Please retry.",
        );
    } finally {
      if (!c.signal.aborted) setBusy("");
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Recovery update copied. Nothing was sent.");
    } catch {
      setNotice(
        "Clipboard unavailable. Select and copy the update text below.",
      );
    }
  }
  return (
    <section
      className="plan-review assist-panel"
      aria-labelledby="assist-heading"
    >
      <header className="plan-header">
        <div className="plan-heading-group">
          <span className="plan-symbol">
            <Cpu size={23} />
          </span>
          <div>
            <span className="eyebrow">READ-ONLY INTELLIGENCE</span>
            <h2 id="assist-heading">Ask about the recovery.</h2>
            <p>
              Local model selects relevant records. Rules check the facts. You
              make the call.
            </p>
          </div>
        </div>
        <span className="plan-version">OPTIONAL · NO CLOUD FALLBACK</span>
      </header>
      <div className="assist-content">
        <div className="assist-prompts" aria-label="Example questions">
          {prompts.map(([label, text]) => (
            <button
              className="secondary-button"
              key={label}
              disabled={!!busy}
              onClick={() => setQuestion(text)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action("ask");
          }}
        >
          <label htmlFor="assist-question">
            Question for the local assistant
          </label>
          <textarea
            id="assist-question"
            value={question}
            required
            maxLength={500}
            rows={2}
            disabled={!!busy}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div className="assist-actions">
            <button
              className="primary-button"
              disabled={!!busy || !question.trim()}
            >
              {busy === "ask" ? "Analyzing local records…" : "Analyze locally"}
            </button>
            {busy === "ask" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  request.current?.abort();
                  setBusy("");
                  setNotice(
                    "Stopped waiting. No work was approved; local inference may finish in the background.",
                  );
                }}
              >
                Stop waiting
              </button>
            )}
            <span>
              Two-minute request limit. Manual review above stays available.
            </span>
          </div>
        </form>
        {busy === "ask" && (
          <p role="status">
            Reading the shift and checking evidence-backed options. No approval
            authority.
          </p>
        )}
        {error && (
          <p className="plan-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {run && (
          <div className="assist-result" aria-label="Local analysis result">
            <h3>{modes[run.mode]}</h3>
            <p>
              {run.mode === "deterministic_fallback"
                ? `Inference outcome: ${run.fallback_reason}. Showing the deterministic recovery, not an AI answer. Retry analysis when the runtime is ready.`
                : "Model-selected references; every explanation and number below is regenerated from checked records. This is a draft, not an approval."}
            </p>
            <p className="assist-meta">
              {run.model_id} · {(run.elapsed_ms / 1000).toFixed(1)}s ·{" "}
              {run.saved_locally
                ? "Audit saved in local LanceDB"
                : "Audit NOT saved; analysis is temporary"}
            </p>
            <ul className="assist-facts">
              {run.facts.map((f) => (
                <li key={f.task_id}>
                  <p>{f.text}</p>
                  <small>
                    Evidence:{" "}
                    {f.evidence_ids.join(", ") ||
                      "No current supporting evidence"}
                  </small>
                </li>
              ))}
            </ul>
            <details>
              <summary>
                Observable tool trace ({run.trace.length} steps)
              </summary>
              <ol className="assist-trace">
                {run.trace.map((t) => (
                  <li key={t.step}>
                    <strong>{t.tool}</strong> · {t.outcome} · {t.inference_ms}ms
                    inference / {t.elapsed_ms}ms checks
                    <span>{t.reference_ids.join(", ")}</span>
                    <span>Evidence: {t.evidence_ids.join(", ") || "none"}</span>
                  </li>
                ))}
              </ol>
              {!run.trace.length && (
                <p>
                  No model tools completed. Deterministic planning remains
                  available.
                </p>
              )}
            </details>
            <button
              className="secondary-button"
              disabled={!!busy}
              onClick={() => void action("review")}
            >
              {busy === "review"
                ? "Rechecking options…"
                : "Review these recovery options"}
            </button>
          </div>
        )}
        {plan && (
          <section
            className="assist-review"
            aria-labelledby="recovery-review-heading"
          >
            <h3 id="recovery-review-heading">
              Human review · selected recovery
            </h3>
            <p>
              Only the assignments below are selected. All other unfinished work
              stays held or deferred. Approval does not complete any work.
            </p>
            <p>
              Assessed {localClock(plan.as_of)} PDT. Evidence review:{" "}
              {plan.review_by
                ? `before ${localClock(plan.review_by)} PDT`
                : "fresh evidence needed"}
              , or sooner if conditions change.
            </p>
            <ul>
              {plan.candidates
                .filter((c) => plan.selected_candidate_ids.includes(c.id))
                .map((c) => (
                  <li key={c.id}>
                    <strong>{taskName(c.task_id)}</strong> —{" "}
                    {site.machines.find((m) => m.id === c.machine_id)?.name},{" "}
                    {site.routes.find((r) => r.id === c.route_id)?.name};{" "}
                    {c.required_hours}h planned effort.
                  </li>
                ))}
            </ul>
            {!plan.selected_candidate_ids.length && (
              <p>No eligible work selected. Nothing can be approved.</p>
            )}
            <details open>
              <summary>Held or deferred work</summary>
              <ul>
                {plan.items
                  .filter(
                    (i) =>
                      i.disposition === "held" || i.disposition === "deferred",
                  )
                  .map((i) => (
                    <li key={i.task_id}>
                      <strong>
                        {taskName(i.task_id)} · {i.disposition}
                      </strong>
                      : {i.reasons.map((r) => r.message).join(" ")}
                      {i.blocking_task_ids.length > 0 &&
                        ` Unfinished: ${i.blocking_task_ids.join(", ")}.`}
                    </li>
                  ))}
              </ul>
            </details>
            <details>
              <summary>Resource budgets & assumptions</summary>
              <ul>
                {plan.resources.map((r) => (
                  <li key={r.machine_id}>
                    {site.machines.find((m) => m.id === r.machine_id)?.name}:{" "}
                    {r.proposed_hours}h selected / {r.available_hours}h
                    available; {r.unallocated_hours}h unallocated (not measured
                    idle time).
                  </li>
                ))}
              </ul>
              <ul>
                {plan.assumptions.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
            {plan.approval ? (
              <div aria-label="Approved recovery updates">
                <h3>
                  <ShieldCheck size={18} /> Recovery approved locally. Nothing
                  dispatched.
                </h3>
                {plan.approval.updates.map((update) => (
                  <article
                    key={update.role}
                    aria-label={`${update.role} recovery update`}
                  >
                    <h4>{update.role}</h4>
                    <button
                      className="secondary-button"
                      onClick={() => void copy(update.body)}
                    >
                      Copy {update.role} recovery update
                    </button>
                    <p className="team-update-body">{update.body}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="assist-approval">
                <label className="review-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={!!busy || !plan.selected_candidate_ids.length}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed the selected assignments, holds, evidence deadline
                  and synthetic planning assumptions.
                </label>
                <button
                  className="primary-button"
                  disabled={
                    !!busy || !reviewed || !plan.selected_candidate_ids.length
                  }
                  onClick={() => void action("approve")}
                >
                  {busy === "approve"
                    ? "Saving recovery…"
                    : "Approve selected recovery"}
                </button>
              </div>
            )}
          </section>
        )}
        <p className="assist-boundary">
          Synthetic operating data, not safety clearance. No image inference,
          autonomous dispatch or guaranteed savings. Inference availability is
          established by a request—not this panel's presence.
        </p>
      </div>
    </section>
  );
}
