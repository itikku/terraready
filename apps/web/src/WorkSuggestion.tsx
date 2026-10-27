import { useEffect, useRef, useState, type FormEvent } from "react";
import { checkWorkSuggestion, evaluateRecovery } from "./api";
import type {
  RecoveryDraft,
  Site,
  SolverCaseResult,
  Task,
  WorkSuggestionResponse,
} from "./types";
import "./work-suggestion.css";

const duration = (minutes: number | null) =>
  minutes === null ? "—" : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const optionName: Record<SolverCaseResult["case"], string> = {
  requested: "Your request",
  minimum_fleet: "Smallest fleet",
  minimum_overtime: "Least overtime",
  maximum_volume: "Most material",
};
const interpretationTitle = {
  interpreted: "Understood request",
  clarification: "More detail needed",
  unsupported: "Outside this demo's scope",
  unavailable: "Local model unavailable",
  timeout: "Model interpretation timed out",
  invalid_output: "No valid interpretation",
};
const atTime = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });

function ScheduleDetails({
  result,
  site,
}: {
  result: SolverCaseResult;
  site: Site;
}) {
  const taskName = (id: string) =>
    site.tasks.find((task) => task.id === id)?.name ?? id;
  return (
    <details className="suggestion-schedule">
      <summary>{optionName[result.case]}: schedule and proof</summary>
      <p>
        {result.solver_status} ·{" "}
        {result.verified
          ? "Schedule independently checked"
          : "No verified schedule"}
      </p>
      <p>
        Objective: {result.objective}. Value: {result.objective_value ?? "—"};
        bound: {result.objective_bound ?? "—"}.
      </p>
      {result.schedule.length > 0 && (
        <div className="suggestion-table-scroll">
          <table>
            <caption>
              Resource schedule, minutes from the evidence clock
            </caption>
            <thead>
              <tr>
                <th>Work</th>
                <th>Resource</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {result.schedule.map((activity) => (
                <tr key={activity.id}>
                  <th scope="row">
                    {taskName(activity.task_id)} ·{" "}
                    {activity.kind.replaceAll("_", " ")}
                  </th>
                  <td>{activity.resource_id}</td>
                  <td>{activity.start_minutes}</td>
                  <td>{activity.end_minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function SuggestionResult({
  response,
  site,
}: {
  response: WorkSuggestionResponse;
  site: Site;
}) {
  const { interpretation, solver } = response;
  const requested = solver?.requested;
  const verifiedGo =
    solver?.verdict === "GO" &&
    requested?.status === "feasible" &&
    requested.verified;
  const verdict = verifiedGo
    ? "GO · planning feasible"
    : solver?.verdict === "NO_GO"
      ? "NO-GO · request cannot proceed"
      : solver?.verdict === "INSPECT"
        ? "INSPECT · field checks needed"
        : "No proven result";
  const inputs = solver?.inputs;
  const production = inputs?.production;
  return (
    <div className="suggestion-result" aria-label="Suggestion result">
      <p className="suggestion-model">
        {interpretation.mode === "test_stub"
          ? "TEST STUB · not real inference"
          : interpretation.mode === "local_model"
            ? `Local model · ${interpretation.model_id}`
            : "Deterministic fallback · no model interpretation"}
      </p>
      <h3>{interpretationTitle[interpretation.status]}</h3>
      <p>{interpretation.message}</p>
      {solver && inputs && production && (
        <>
          <p className="suggestion-understood">
            {inputs.include_haul
              ? `${inputs.target_bank_m3} bank m³ · up to ${inputs.max_trucks} truck/operator pairs · `
              : "Current work · "}
            {inputs.max_overtime_minutes} minutes overtime allowed
            {inputs.deadline_minutes !== null
              ? ` · finish within ${inputs.deadline_minutes} minutes`
              : ""}
            .
            {inputs.keep_other_work
              ? " Retain the other selected work."
              : " Other selected work may be released for this what-if."}
          </p>
          <h4 className={`suggestion-verdict ${verifiedGo ? "go" : "hold"}`}>
            {verdict}
          </h4>
          <p>{solver.requested.message}</p>
          {verifiedGo && (
            <p>
              {inputs.include_haul &&
                `${requested!.delivered_bank_m3} bank m³ · ${requested!.fleet} truck/operator pair(s) · `}
              Checked finish: {duration(requested!.finish_minutes)}; overtime:{" "}
              {requested!.overtime_minutes} minutes.
            </p>
          )}
          {solver.requested.additional_resources_required > 0 && (
            <p>
              <strong>
                Conditional on {solver.requested.additional_resources_required}{" "}
                additional truck/operator pair(s).
              </strong>{" "}
              Availability is not established.
            </p>
          )}
          {solver.ground_reasons.length > 0 && (
            <p>
              Ground/access:{" "}
              {solver.ground_reasons.map((reason) => reason.message).join(" ")}
            </p>
          )}
          {solver.requested.conflicts.length > 0 && (
            <ul aria-label="Conflicting constraints">
              {solver.requested.conflicts.map((conflict) => (
                <li key={conflict}>{conflict}</li>
              ))}
            </ul>
          )}
          {solver.alternatives.length > 0 && (
            <section aria-label="Checked alternatives">
              <h4>Checked alternatives</h4>
              <p>Separate what-ifs. These do not change your draft.</p>
              <div className="suggestion-options">
                {solver.alternatives.map((alternative) => (
                  <article key={alternative.case}>
                    <h5>{optionName[alternative.case]}</h5>
                    {alternative.status === "feasible" &&
                    alternative.verified ? (
                      <>
                        <p>
                          <strong>
                            {alternative.delivered_bank_m3} bank m³
                          </strong>{" "}
                          · {alternative.fleet} truck/operator pair(s) ·{" "}
                          {duration(alternative.finish_minutes)} ·{" "}
                          {alternative.overtime_minutes}m overtime
                        </p>
                        {alternative.additional_resources_required > 0 && (
                          <p>
                            Requires {alternative.additional_resources_required}{" "}
                            hypothetical additional pair(s); confirm
                            availability.
                          </p>
                        )}
                        <p>
                          {alternative.solver_status === "OPTIMAL"
                            ? "Proven best for this objective."
                            : "Feasible; optimality not proven."}
                        </p>
                      </>
                    ) : (
                      <p>
                        {alternative.status === "infeasible"
                          ? "No feasible alternative."
                          : "No proven alternative."}{" "}
                        {alternative.message}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          <div className="suggestion-assumptions">
            <h4>Synthetic production assumptions</h4>
            <p>
              {production.payload_loose_m3} loose m³/load ÷{" "}
              {production.swell_factor} swell = {production.bank_m3_per_load}{" "}
              bank m³/load. Each cycle: {production.load_minutes}m loading +{" "}
              {production.loaded_travel_minutes}m travel +{" "}
              {production.dump_minutes}m dumping + {production.return_minutes}m
              return.
            </p>
            <p>
              One truck/operator pair is in the demo inventory. Any additional
              pairs are hypothetical. Loader, truck and dump queues share a{" "}
              {inputs.shift_minutes}-minute remaining window.
            </p>
          </div>
          <p className="suggestion-boundary">
            Ground checked at {atTime(solver.as_of)} Pacific
            {solver.review_by
              ? `; inspect again by ${atTime(solver.review_by)} Pacific`
              : ""}
            . A feasible schedule does not certify future ground conditions.
          </p>
          <details className="suggestion-proof">
            <summary>Schedule, constraints and solver details</summary>
            <p>
              {solver.solver} · {solver.solver_workers} solver worker · source{" "}
              {solver.source_plan_id}
            </p>
            <ul>
              {solver.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
            <ScheduleDetails result={solver.requested} site={site} />
            {solver.alternatives.map((alternative) => (
              <ScheduleDetails
                key={alternative.case}
                result={alternative}
                site={site}
              />
            ))}
          </details>
        </>
      )}
    </div>
  );
}

export default function WorkSuggestion({
  task,
  site,
  draft,
  draftAssignment,
}: {
  task: Task;
  site: Site;
  draft: RecoveryDraft | null;
  draftAssignment: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [response, setResponse] = useState<WorkSuggestionResponse | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const draftFingerprint = JSON.stringify([
    draft?.catalog_id,
    draft?.candidate_ids,
    draft?.as_of,
  ]);
  useEffect(() => {
    if (request.current) {
      request.current.abort();
      request.current = null;
      setNotice(
        "Your work choices changed. Check the suggestion again against the current draft.",
      );
    }
    setBusy(false);
    setResponse(null);
    setError("");
  }, [draftFingerprint]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !text.trim() || busy) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setResponse(null);
    try {
      // Bind the what-if to the actual editable selection, not the default recommendation.
      const checked = await evaluateRecovery(
        draft.candidate_ids,
        controller.signal,
        draft.as_of,
      );
      const result = await checkWorkSuggestion(
        {
          task_id: task.id,
          suggestion: text.trim(),
          source_plan_id: checked.id,
          current_candidate_ids: checked.selected_candidate_ids,
          as_of: checked.as_of,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        result.task_id !== task.id ||
        result.interpretation.task_id !== task.id ||
        result.source_plan_id !== checked.id ||
        (result.solver &&
          (result.solver.task_id !== task.id ||
            result.solver.source_plan_id !== checked.id))
      )
        throw new Error(
          "The result did not match this item and draft. Check the suggestion again.",
        );
      setResponse(result);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "The suggestion could not be checked. Your work choices are unchanged.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function cancel() {
    request.current?.abort();
    setBusy(false);
    setNotice(
      "Stopped waiting. The model may finish its current request; your work choices are unchanged.",
    );
  }
  return (
    <details className="work-suggestion">
      <summary>Suggest a change</summary>
      <form
        onSubmit={(event) => void submit(event)}
        aria-label={`Suggestion for ${task.name}`}
      >
        <label htmlFor="work-suggestion-text">
          Your suggestion for {task.name}
        </label>
        {draft && <p>Current draft: {draftAssignment}</p>}
        <p id="suggestion-help">
          Ask about volume, truck/operator pairs, overtime or timing. This
          evaluation does not change work choices or approve work.
        </p>
        <textarea
          id="work-suggestion-text"
          aria-describedby="suggestion-help"
          value={text}
          maxLength={500}
          rows={3}
          required
          placeholder="Could we finish with two trucks and no overtime?"
          onChange={(event) => {
            setText(event.target.value);
            setResponse(null);
            setError("");
          }}
          disabled={busy}
        />
        <div className="suggestion-actions">
          <button type="submit" disabled={busy || !draft || !text.trim()}>
            Check suggestion
          </button>
          {busy && (
            <button type="button" className="text-button" onClick={cancel}>
              Stop waiting
            </button>
          )}
        </div>
        {!draft && <p role="status">Loading your current work choices…</p>}
        {busy && (
          <p role="status">
            Interpreting your suggestion and checking the schedule…
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
      {response && <SuggestionResult response={response} site={site} />}
    </details>
  );
}
