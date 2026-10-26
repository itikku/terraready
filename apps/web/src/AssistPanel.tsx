import { useEffect, useRef, useState } from "react";
import { askAssistant } from "./api";
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

export default function AssistPanel({
  asOf,
  onChooseWork,
  site,
  overview,
  selectedTask,
  selectedRoute,
  selectedMachine,
  onInspectTask,
}: {
  asOf?: string;
  onChooseWork: () => void;
  site: Site;
  overview: RecoveryPlan | null;
  selectedTask: string;
  selectedRoute: string;
  selectedMachine: string;
  onInspectTask: (task: string, candidate?: string | null) => void;
}) {
  const [question, setQuestion] = useState(
    "What changed in today's shift, and what can we recover?",
  );
  const [run, setRun] = useState<AssistRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const taskName = (id: string) =>
    site.tasks.find((task) => task.id === id)?.name ?? id;
  const request = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (run) {
      resultHeading.current?.focus();
      resultHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [run]);

  async function analyze() {
    if (busy || !question.trim()) return;
    const c = new AbortController();
    request.current = c;
    setBusy(true);
    setRun(null);
    setError("");
    setNotice("");
    try {
      const result = await askAssistant(question.trim(), c.signal, asOf);
      if (!c.signal.aborted) setRun(result);
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Local request failed. Please retry.",
        );
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="local-assessment" aria-labelledby="assist-heading">
      <h2 id="assist-heading">Check the shift with the local model</h2>
      <p className="assessment-intro">
        Reads site conditions and checks feasible work. You choose what to
        approve.
      </p>
      {!run && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void analyze();
          }}
        >
          <details className="assessment-question">
            <summary>Ask a specific question</summary>
            <label htmlFor="assist-question">
              Question for the local assistant
            </label>
            <textarea
              id="assist-question"
              value={question}
              required
              maxLength={500}
              rows={2}
              disabled={busy}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <div className="assist-prompts" aria-label="Example questions">
              {prompts.map(([label, text]) => (
                <button
                  type="button"
                  className="text-button"
                  key={label}
                  disabled={busy}
                  onClick={() => setQuestion(text)}
                >
                  {label}
                </button>
              ))}
            </div>
          </details>
          <div className="assessment-actions">
            <button
              className="primary-button"
              disabled={busy || !question.trim()}
            >
              {busy ? "Assessing local conditions…" : "Assess this shift"}
            </button>
            {busy ? (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  request.current?.abort();
                  setBusy(false);
                  setNotice(
                    "Stopped waiting. No work was approved; local inference may finish in the background.",
                  );
                }}
              >
                Stop waiting
              </button>
            ) : (
              <button
                type="button"
                className="text-button"
                onClick={onChooseWork}
              >
                Choose work without the model
              </button>
            )}
          </div>
        </form>
      )}
      {!run && !busy && (
        <div className="shift-work-list" aria-label="Shift work list">
          <h3>Today's work</h3>
          <p>Select a package to locate it on the map.</p>
          <ul>
            {site.tasks.map((task) => {
              const item = overview?.items.find(
                (item) => item.task_id === task.id,
              );
              const labels: Record<string, string> = {
                retain: "Keep",
                reroute: "Reroute",
                pull_forward: "Ready backlog",
                reassign: "Reassign",
                held: "Held",
                deferred: "Deferred",
                completed: "Completed",
              };
              const candidate = overview?.candidates.find(
                (c) => c.id === item?.selected_candidate_id,
              );
              const state =
                item?.disposition === "ready"
                  ? (item.action ?? "ready")
                  : item?.disposition;
              return (
                <li key={task.id}>
                  <button
                    className="work-map-link"
                    aria-pressed={
                      selectedTask === task.id &&
                      (!candidate ||
                        (candidate.route_id === selectedRoute &&
                          candidate.machine_id === selectedMachine))
                    }
                    onClick={() =>
                      onInspectTask(task.id, item?.selected_candidate_id)
                    }
                  >
                    <strong>{task.name}</strong>
                    <span>
                      {item
                        ? (labels[state ?? ""] ?? "Review")
                        : "Check required"}{" "}
                      · {task.duration_hours}h planned
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {busy && (
        <div className="assessment-loading" role="status">
          <p>Reading the shift and checking site evidence…</p>
          <div className="assessment-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      {error && (
        <p className="plan-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {run && (
        <div className="assist-result" aria-label="Local analysis result">
          <h3 ref={resultHeading} tabIndex={-1}>
            {modes[run.mode]}
          </h3>
          {run.mode === "deterministic_fallback" && (
            <p className="assessment-fallback">
              Inference outcome: {run.fallback_reason}. The model did not
              finish. These are rules-only options; you can still choose work
              manually.
            </p>
          )}
          {!overview && (
            <p role="status">
              Map details for these options could not be loaded. Reload the
              shift to inspect them; you can still review work manually.
            </p>
          )}
          <ul className="assist-facts">
            {run.facts.map((f) => (
              <li key={f.task_id}>
                <button
                  className="work-map-link"
                  disabled={
                    !!f.candidate_id &&
                    !overview?.candidates.some((c) => c.id === f.candidate_id)
                  }
                  aria-pressed={
                    selectedTask === f.task_id &&
                    (!f.candidate_id ||
                      (overview?.candidates.find((c) => c.id === f.candidate_id)
                        ?.route_id === selectedRoute &&
                        overview?.candidates.find(
                          (c) => c.id === f.candidate_id,
                        )?.machine_id === selectedMachine))
                  }
                  onClick={() => onInspectTask(f.task_id, f.candidate_id)}
                >
                  <strong>{taskName(f.task_id)}</strong>
                  <span>
                    {f.candidate_id
                      ? (() => {
                          const candidate = overview?.candidates.find(
                            (c) => c.id === f.candidate_id,
                          );
                          const route = site.routes.find(
                            (r) => r.id === candidate?.route_id,
                          );
                          return candidate && route
                            ? `${route.name} · ${candidate.required_hours}h checked`
                            : "Checked option";
                        })()
                      : "Held · checks required"}
                  </span>
                </button>
                <details className="fact-detail">
                  <summary>Why this option?</summary>
                  <p>{f.text}</p>
                </details>
              </li>
            ))}
          </ul>
          <div className="assessment-actions">
            <button className="primary-button" onClick={onChooseWork}>
              Choose work to approve
            </button>
            <button
              className="text-button"
              onClick={() => {
                setRun(null);
                setNotice("");
              }}
            >
              Ask another question
            </button>
          </div>
          <details className="assessment-trace">
            <summary>Evidence and model trace</summary>
            <p className="assist-meta">
              {run.model_id} · {(run.elapsed_ms / 1000).toFixed(1)}s ·{" "}
              {run.saved_locally
                ? "Audit saved in local LanceDB"
                : "Audit NOT saved; analysis is temporary"}
            </p>
            <ul>
              {run.facts.map((f) => (
                <li key={f.task_id}>
                  Evidence:{" "}
                  {f.evidence_ids.join(", ") ||
                    "No current supporting evidence"}
                </li>
              ))}
            </ul>
            <p>Observable tool trace ({run.trace.length} steps)</p>
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
        </div>
      )}
    </section>
  );
}
