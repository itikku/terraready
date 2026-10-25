import { useEffect, useRef, useState } from "react";
import { approveRecovery, evaluateRecovery, getRecovery } from "./api";
import type { RecoveryPlan, Site } from "./types";
import "./recovery.css";

const clock = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const choicesFor = (plan: RecoveryPlan) =>
  Object.fromEntries(
    plan.candidates
      .filter((c) => plan.selected_candidate_ids.includes(c.id))
      .map((c) => [c.task_id, c.id]),
  );

export default function RecoveryWorkspace({
  site,
  asOf,
  inspect,
}: {
  site: Site;
  asOf?: string;
  inspect: (zone: string) => void;
}) {
  const [catalog, setCatalog] = useState<RecoveryPlan | null>(null);
  const [checked, setChecked] = useState<RecoveryPlan | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<"edit" | "review">("edit");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const approvalHeading = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<"review" | "approval" | null>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const storageKey = `terraready-recovery-${site.scenario.id}-${asOf ?? site.scenario.as_of}`;
  const ids = Object.values(choices).filter(Boolean);
  const approval = checked?.approval;
  const taskName = (id: string) => site.tasks.find((t) => t.id === id)!.name;
  const machineName = (id: string) =>
    site.machines.find((m) => m.id === id)!.name;
  const routeName = (id: string) => site.routes.find((r) => r.id === id)!.name;
  const reasonsFor = (item: RecoveryPlan["items"][number]) =>
    item.reasons
      .map((reason) => {
        if (reason.code === "GROUND_OR_CAPABILITY")
          return "No assignment passes the current ground or equipment checks. Inspect the evidence before selecting this work.";
        if (reason.code === "UNFINISHED_PREREQUISITES")
          return `Requires actual completion: ${item.blocking_task_ids.map(taskName).join(", ")}. Approval does not complete it.`;
        if (reason.code === "CAPACITY_RESERVED")
          return "Other selected work uses the remaining resource hours.";
        if (reason.code === "NOT_SELECTED")
          return "Not selected for this response.";
        return reason.message;
      })
      .join(" ");
  useEffect(() => {
    const c = new AbortController();
    request.current = c;
    async function load() {
      try {
        const source = await getRecovery(c.signal, asOf);
        let plan = source;
        // Only checked choice IDs are browser state; the API remains authoritative.
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(storageKey) ?? "null",
          );
          if (
            saved?.source === source.id &&
            Array.isArray(saved.ids) &&
            saved.ids.length <= source.items.length &&
            saved.ids.every(
              (id: unknown) =>
                typeof id === "string" &&
                source.candidates.some((candidate) => candidate.id === id),
            )
          ) {
            plan = await evaluateRecovery(saved.ids, c.signal, asOf);
          }
        } catch {
          // A stale/unreadable draft never prevents a fresh checked recommendation.
        }
        if (c.signal.aborted) return;
        setCatalog(source);
        setChecked(plan);
        setChoices(choicesFor(plan));
        setStage(plan.approval ? "review" : "edit");
        setBusy("");
      } catch (e) {
        if (!c.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "Shift could not be loaded.",
          );
          setBusy("");
        }
      }
    }
    setCatalog(null);
    setChecked(null);
    setConfirmed(false);
    setError("");
    setBusy("loading");
    void load();
    return () => {
      c.abort();
      request.current?.abort();
    };
  }, [asOf, retry, storageKey]);

  function change(task: string, candidate: string) {
    request.current?.abort();
    setBusy("");
    setChoices((current) => ({ ...current, [task]: candidate }));
    setChecked(null);
    setConfirmed(false);
    setError("");
    setNotice(
      "Choices changed. Review again to check the combined resource limits.",
    );
  }
  async function review() {
    if (busy || !ids.length || !catalog) return;
    const c = new AbortController();
    request.current?.abort();
    request.current = c;
    setBusy("checking");
    setConfirmed(false);
    setChecked(null);
    setError("");
    setNotice("");
    try {
      const plan = await evaluateRecovery(ids, c.signal, asOf);
      if (c.signal.aborted) return;
      focusNext.current = plan.approval ? "approval" : "review";
      setChecked(plan);
      setStage("review");
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            source: catalog.id,
            ids: plan.selected_candidate_ids,
          }),
        );
      } catch {
        setNotice(
          "This browser could not keep your choices for reload. You can still approve them.",
        );
      }
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Choices could not be checked.",
        );
    } finally {
      if (!c.signal.aborted) setBusy("");
    }
  }
  async function approve() {
    if (
      !checked ||
      !confirmed ||
      busy ||
      !checked.selected_candidate_ids.length
    )
      return;
    const c = new AbortController();
    request.current?.abort();
    request.current = c;
    setBusy("saving");
    setError("");
    try {
      const approval = await approveRecovery(checked, c.signal);
      if (c.signal.aborted) return;
      if (approval.plan_id !== checked.id)
        throw new Error(
          "The saved response does not match these choices. Review them again.",
        );
      focusNext.current = "approval";
      setChecked({ ...checked, approval });
    } catch (e) {
      if (!c.signal.aborted) {
        setConfirmed(false);
        setChecked(null);
        setStage("edit");
        setError(
          e instanceof Error ? e.message : "Approval could not be saved.",
        );
      }
    } finally {
      if (!c.signal.aborted) setBusy("");
    }
  }
  async function copy(role: string, body: string) {
    try {
      await navigator.clipboard.writeText(body);
      setNotice(`${role} brief copied. Nothing was sent.`);
    } catch {
      setNotice("Clipboard unavailable. Select and copy the displayed brief.");
    }
  }
  useEffect(() => {
    if (stage !== "review" || !checked) return;
    if (focusNext.current === "review") reviewHeading.current?.focus();
    if (focusNext.current === "approval" && approval) {
      approvalHeading.current?.focus();
      setNotice(
        "Response saved for your selected assignments. Team briefs are ready.",
      );
    }
    focusNext.current = null;
  }, [stage, checked, approval]);

  return (
    <section className="recovery-workspace" aria-labelledby="recovery-heading">
      <header className="recovery-header">
        <div>
          <span className="eyebrow">SHIFT RECOVERY · YOUR DECISIONS</span>
          <h2 id="recovery-heading" ref={editHeading} tabIndex={-1}>
            Choose this shift's work
          </h2>
          <p>
            Keep, reroute or defer each package. Rules check your choices; you
            approve the exact response.
          </p>
        </div>
        <a className="secondary-button" href="#ground-evidence">
          Inspect ground evidence
        </a>
      </header>
      {!catalog ? (
        <div className="recovery-body">
          {busy && <p role="status">Checking this shift…</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && (
            <button
              className="secondary-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry shift
            </button>
          )}
        </div>
      ) : (
        <div className="recovery-body">
          {stage === "edit" ? (
            <>
              <div className="recovery-summary">
                <div>
                  <strong>{ids.length} selected</strong>
                  <span>
                    {catalog.items.length} packages ·{" "}
                    {
                      catalog.items.filter((i) => i.state === "completed")
                        .length
                    }{" "}
                    already completed
                  </span>
                </div>
                <p>
                  West work stays held until its ground and prerequisite checks
                  pass.{" "}
                  {checked?.review_by
                    ? `Review evidence before ${clock(checked.review_by)} PDT, or sooner if conditions change.`
                    : "Check your selection for its evidence deadline."}
                </p>
                <button
                  className="primary-button"
                  onClick={() => void review()}
                  disabled={!!busy || !ids.length}
                >
                  {busy === "checking"
                    ? "Checking choices…"
                    : `Review ${ids.length} assignment${ids.length === 1 ? "" : "s"}`}
                </button>
              </div>
              <p className="recovery-guidance">
                Start from the checked recommendation, then make your own
                choices. An alternative is individually eligible; the full
                combination must still fit the resource budgets.
              </p>
              {!ids.length && (
                <p className="recovery-hold">
                  No work selected. Choose ready work, or get fresh evidence
                  before approving anything.
                </p>
              )}
              <div className="recovery-packages">
                {catalog.items
                  .filter((i) => i.state !== "completed")
                  .map((item) => {
                    const task = site.tasks.find((t) => t.id === item.task_id)!;
                    const options = catalog.candidates.filter(
                      (c) => c.task_id === item.task_id && c.eligible,
                    );
                    const candidate = options.find(
                      (c) => c.id === choices[item.task_id],
                    );
                    return (
                      <article
                        key={item.task_id}
                        aria-label={`${task.name} choice`}
                      >
                        <div className="recovery-package-heading">
                          <h3>{task.name}</h3>
                          <span
                            className={
                              options.length
                                ? "recovery-choice-status"
                                : "recovery-blocked"
                            }
                          >
                            {!options.length
                              ? "Held · checks required"
                              : candidate
                                ? checked
                                  ? "Selected · checked"
                                  : "Selected · check needed"
                                : "Not selected"}
                          </span>
                        </div>
                        <label htmlFor={`choice-${item.task_id}`}>
                          Decision for {task.name}
                        </label>
                        <select
                          id={`choice-${item.task_id}`}
                          value={choices[item.task_id] ?? ""}
                          disabled={!options.length || busy === "saving"}
                          onChange={(e) => change(item.task_id, e.target.value)}
                        >
                          <option value="">
                            {options.length
                              ? "Defer this package"
                              : "Held — no eligible assignment"}
                          </option>
                          {options.map((c) => (
                            <option key={c.id} value={c.id}>
                              {machineName(c.machine_id)} ·{" "}
                              {routeName(c.route_id)} · {c.required_hours}h
                            </option>
                          ))}
                        </select>
                        {item.reasons.length > 0 && !options.length && (
                          <p className="recovery-reasons">{reasonsFor(item)}</p>
                        )}
                        <button
                          className="recovery-evidence-link"
                          onClick={() => inspect(task.zone_id)}
                        >
                          Inspect evidence for {task.name}
                        </button>
                      </article>
                    );
                  })}
              </div>
              <details className="recovery-details">
                <summary>Completed work and resource availability</summary>
                <ul>
                  {catalog.items
                    .filter((i) => i.state === "completed")
                    .map((i) => (
                      <li key={i.task_id}>
                        {taskName(i.task_id)} · completed in the fixture
                      </li>
                    ))}
                  {catalog.resources.map((r) => (
                    <li key={r.machine_id}>
                      {machineName(r.machine_id)}: {r.available_hours}h
                      available in the scenario.
                    </li>
                  ))}
                </ul>
                <p>
                  Hours describe serial planned effort, not a timed schedule or
                  measured savings. Combined use is rechecked before review.
                </p>
              </details>
            </>
          ) : (
            checked && (
              <section
                className="recovery-exact-review"
                aria-labelledby="recovery-review-title"
              >
                <h3
                  ref={reviewHeading}
                  tabIndex={-1}
                  id="recovery-review-title"
                >
                  Review your {checked.selected_candidate_ids.length} assignment
                  {checked.selected_candidate_ids.length === 1 ? "" : "s"}
                </h3>
                <p>
                  Assessed {clock(checked.as_of)} PDT. Evidence review:{" "}
                  {checked.review_by
                    ? `before ${clock(checked.review_by)} PDT`
                    : "fresh evidence needed"}
                  , or sooner if conditions change.
                </p>
                <ul className="recovery-selected">
                  {checked.candidates
                    .filter((c) =>
                      checked.selected_candidate_ids.includes(c.id),
                    )
                    .map((c) => (
                      <li key={c.id}>
                        <strong>{taskName(c.task_id)}</strong>
                        <span>
                          {machineName(c.machine_id)} · {routeName(c.route_id)}{" "}
                          · {c.required_hours}h planned effort
                        </span>
                      </li>
                    ))}
                </ul>
                <div className="recovery-hold">
                  <h4>Held or deferred work is excluded</h4>
                  <ul>
                    {checked.items
                      .filter(
                        (i) =>
                          i.disposition === "held" ||
                          i.disposition === "deferred",
                      )
                      .map((i) => (
                        <li key={i.task_id}>
                          <strong>
                            {taskName(i.task_id)} · {i.disposition}
                          </strong>
                          : {reasonsFor(i)}
                        </li>
                      ))}
                  </ul>
                  <p>
                    Approval does not finish work, satisfy prerequisites or
                    authorize entry onto unverified ground.
                  </p>
                </div>
                <details className="recovery-details">
                  <summary>Checked resource budgets and assumptions</summary>
                  <ul>
                    {checked.resources.map((r) => (
                      <li key={r.machine_id}>
                        {machineName(r.machine_id)}: {r.proposed_hours}h
                        selected / {r.available_hours}h available.
                      </li>
                    ))}
                    {checked.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
                {checked.approval ? (
                  <div
                    className="recovery-briefs"
                    aria-label="Approved shift recovery briefs"
                  >
                    <h3 ref={approvalHeading} tabIndex={-1}>
                      Response approved. Prepare the team briefs.
                    </h3>
                    <p>
                      Saved locally for this exact selection. Nothing sent or
                      dispatched.
                    </p>
                    {checked.approval.updates.map((update) => (
                      <article key={update.role}>
                        <h4>{update.role}</h4>
                        <button
                          className="secondary-button"
                          onClick={() => void copy(update.role, update.body)}
                        >
                          Copy {update.role.toLowerCase()} brief
                        </button>
                        <p className="team-update-body">{update.body}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="recovery-confirm">
                    <label className="review-check">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={!!busy}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      I reviewed these assignments, held/deferred work, resource
                      limits and the evidence deadline.
                    </label>
                    <button
                      className="primary-button"
                      disabled={
                        !confirmed ||
                        !!busy ||
                        !checked.selected_candidate_ids.length
                      }
                      onClick={() => void approve()}
                    >
                      {busy === "saving"
                        ? "Saving response…"
                        : checked.selected_candidate_ids.length === 1
                          ? "Approve this assignment"
                          : `Approve these ${checked.selected_candidate_ids.length} assignments`}
                    </button>
                  </div>
                )}
                <button
                  className="secondary-button"
                  disabled={!!busy}
                  onClick={() => {
                    setStage("edit");
                    setChecked(null);
                    setConfirmed(false);
                    setError("");
                    setNotice("");
                    editHeading.current?.focus();
                  }}
                >
                  Change package decisions
                </button>
              </section>
            )
          )}
          {error && (
            <div className="recovery-error" role="alert">
              <p>{error}</p>
              <button
                className="secondary-button"
                disabled={!!busy}
                onClick={() => setRetry((n) => n + 1)}
              >
                Reload checked recommendation
              </button>
            </div>
          )}
          <p className="recovery-notice" role="status">
            {busy === "checking"
              ? "Checking your choices against the current constraints…"
              : busy === "saving"
                ? "Saving your reviewed response…"
                : notice}
          </p>
          <p className="recovery-boundary">
            Synthetic operating data · no camera connected by default. Approval
            is a local planning record, not dispatch or safety clearance.
          </p>
        </div>
      )}
    </section>
  );
}
