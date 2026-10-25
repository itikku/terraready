import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  GitBranch,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { approvePlan, getPlan } from "./api";
import type { ShiftPlan, Site, Status } from "./types";
import "./plan.css";

const labels: Record<Status, string> = {
  GO: "Eligible now",
  INSPECT: "Hold · inspect",
  NO_GO: "Hold · no-go",
};
const clock = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export default function PlanReview({
  site,
  asOf,
}: {
  site: Site;
  asOf?: string;
}) {
  const [plan, setPlan] = useState<ShiftPlan | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const saveRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const c = new AbortController();
    generation.current += 1;
    saveRequest.current?.abort();
    setSaving(false);
    setReviewed(false);
    setPlan(null);
    setError("");
    getPlan(c.signal, asOf)
      .then(setPlan)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => {
      c.abort();
      saveRequest.current?.abort();
    };
  }, [asOf, retry]);

  async function approve() {
    if (!plan || !reviewed || saving || !plan.proposed_eligible_count) return;
    const c = new AbortController();
    const requestGeneration = generation.current;
    saveRequest.current = c;
    setSaving(true);
    setError("");
    try {
      const approval = await approvePlan(plan.id, c.signal, asOf);
      if (!c.signal.aborted && requestGeneration === generation.current)
        setPlan((current) =>
          current?.id === approval.plan_id ? { ...current, approval } : current,
        );
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Approval could not be saved.",
        );
    } finally {
      if (!c.signal.aborted) setSaving(false);
    }
  }
  async function copy(role: string, body: string) {
    try {
      await navigator.clipboard.writeText(body);
      setCopyNotice(`${role} update copied. Nothing was sent.`);
    } catch {
      setCopyNotice(
        "Clipboard unavailable. Select the update text or download the shift brief.",
      );
    }
  }
  function download() {
    if (!plan?.approval) return;
    const text = [
      "# TerraReady · approved demo shift brief",
      `Plan: ${plan.id}`,
      `Approved locally: ${plan.approval.approved_at}`,
      "Synthetic scenario. Not a safety clearance. Nothing sent or dispatched.",
      ...plan.approval.updates.map(
        (update) => `## ${update.role}\n\n${update.body}`,
      ),
      "## Assumptions\n\n" +
        plan.assumptions.map((text) => `- ${text}`).join("\n"),
    ].join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `terraready-shift-${plan.id.slice(0, 12)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="plan-review"
      aria-labelledby="plan-heading"
      id="shift-plan"
    >
      <header className="plan-header">
        <div className="plan-heading-group">
          <span className="plan-symbol">
            <GitBranch size={23} />
          </span>
          <div>
            <span className="eyebrow">FROM OBSERVATION TO OPERATION</span>
            <h2 id="plan-heading">Keep the work. Change the plan.</h2>
            <p>
              Compare every access route. Keep uncertainty out of the operating
              plan.
            </p>
          </div>
        </div>
        <span className="plan-version">RULES-BASED · LOCAL ONLY</span>
      </header>
      {!plan ? (
        <div className="plan-wait" role={error ? "alert" : "status"}>
          <p>{error || "Comparing routes against the local evidence…"}</p>
          {error && (
            <button
              className="secondary-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry plan comparison
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="plan-summary">
            <div>
              <span>ORIGINAL PLAN</span>
              <strong>
                {plan.baseline_eligible_count}
                <small> / {plan.items.length} work packages eligible</small>
              </strong>
            </div>
            <ArrowRight size={22} />
            <div>
              <span>PROPOSED PLAN · {clock(plan.as_of)} PDT</span>
              <strong>
                {plan.proposed_eligible_count}
                <small> / {plan.items.length} work packages eligible</small>
              </strong>
            </div>
            <div className="plan-deadline">
              <span>EVIDENCE REVIEW</span>
              <strong>
                {plan.review_by
                  ? `Before ${clock(plan.review_by)} PDT`
                  : "Fresh checks needed"}
              </strong>
              <small>Or immediately if conditions change</small>
            </div>
          </div>
          <div className="plan-work" aria-label="Original and proposed work">
            {plan.items.map((item) => {
              const task = site.tasks.find((task) => task.id === item.task_id)!;
              const machine = site.machines.find(
                (machine) => machine.id === task.assigned_machine_id,
              )!;
              const routeName = (id: string) =>
                site.routes.find((route) => route.id === id)!.name;
              return (
                <article
                  className="plan-work-item"
                  key={item.task_id}
                  aria-label={`${task.name} plan`}
                >
                  <div className="plan-task">
                    <span className="plan-priority">P{task.priority}</span>
                    <div>
                      <h3>{task.name}</h3>
                      <p>
                        {machine.name} · {task.target_quantity}{" "}
                        {task.quantity_unit === "m3"
                          ? "m³"
                          : task.quantity_unit}{" "}
                        target · {task.duration_hours}h planned
                      </p>
                    </div>
                  </div>
                  <div className="plan-route">
                    <span className="eyebrow">ORIGINAL</span>
                    <strong>{routeName(item.baseline.route_id)}</strong>
                    <span
                      className={`plan-status ${item.baseline.status.toLowerCase()}`}
                    >
                      {labels[item.baseline.status]}
                    </span>
                  </div>
                  <ArrowRight className="plan-route-arrow" size={18} />
                  <div className="plan-route">
                    <span className="eyebrow">RECOMMENDATION</span>
                    <strong>
                      {item.selected_route_id
                        ? routeName(item.selected_route_id)
                        : "Hold for field review"}
                    </strong>
                    <span
                      className={`plan-status ${item.status.toLowerCase()}`}
                    >
                      {labels[item.status]}
                    </span>
                  </div>
                  <details className="route-alternatives">
                    <summary>
                      Why this recommendation? · {item.alternatives.length}{" "}
                      route{item.alternatives.length === 1 ? "" : "s"} checked
                    </summary>
                    <div>
                      {item.alternatives.map((result) => (
                        <div key={result.route_id}>
                          <strong>
                            {routeName(result.route_id)} ·{" "}
                            {labels[result.status]}
                          </strong>
                          <p>
                            {result.zone_decisions
                              .filter((zone) => zone.status !== "GO")
                              .map(
                                (decision) =>
                                  `${site.zones.find((zone) => zone.id === decision.zone_id)!.name}: ${decision.reasons.map((reason) => reason.message).join(" ")}`,
                              )
                              .join(" ") ||
                              result.reasons
                                .map((reason) => reason.message)
                                .join(" ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
          <div className="plan-context">
            <div>
              <span className="eyebrow">FACTS · SYNTHETIC FIXTURE</span>
              <p>
                18 mm overnight rain. Assigned machine limits and timestamped
                observations determine route eligibility—not the inspection
                illustration.
              </p>
            </div>
            <div>
              <span className="eyebrow">UNRESOLVED</span>
              <p>
                {plan.items.length - plan.proposed_eligible_count} work package
                {plan.items.length - plan.proposed_eligible_count === 1
                  ? ""
                  : "s"}{" "}
                held. A new inspection must be evaluated before held work can
                enter the plan. No entry onto unverified ground is authorized.
              </p>
            </div>
          </div>
          <details className="plan-assumptions">
            <summary>Planning assumptions & limits</summary>
            <ul>
              {plan.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </details>
          <div
            className={`plan-approval ${plan.approval ? "is-approved" : ""}`}
          >
            {plan.approval ? (
              <>
                <ShieldCheck size={25} />
                <div>
                  <h3>Approved locally. Ready to brief the team.</h3>
                  <p>
                    Saved in LanceDB · {plan.approval.approved_by} · plan{" "}
                    {plan.id.slice(0, 12)}. Held work stays held. Nothing sent
                    or dispatched.
                  </p>
                </div>
                <button className="secondary-button" onClick={download}>
                  <Download size={16} /> Download shift brief
                </button>
              </>
            ) : (
              <>
                <div>
                  <h3>
                    {plan.proposed_eligible_count
                      ? "Superintendent review"
                      : "All work is held. Get fresh evidence first."}
                  </h3>
                  <label className="review-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={!plan.proposed_eligible_count || saving}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    I reviewed the route changes, held work and planning limits.
                  </label>
                </div>
                <button
                  className="primary-button"
                  disabled={
                    !reviewed || saving || !plan.proposed_eligible_count
                  }
                  onClick={approve}
                >
                  <Check size={17} />
                  {saving ? "Saving local approval…" : "Approve revised plan"}
                </button>
              </>
            )}
          </div>
          {error && (
            <div className="plan-error" role="alert">
              <p>{error}</p>
              <button
                className="secondary-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                <RefreshCw size={15} /> Refresh plan
              </button>
            </div>
          )}
          {plan.approval && (
            <section
              className="team-updates"
              aria-label="Approved teammate updates"
            >
              <div className="team-updates-heading">
                <div>
                  <span className="eyebrow">
                    THE RIGHT CONTEXT, TO THE RIGHT PERSON
                  </span>
                  <h3>Two teammates. Two clear next steps.</h3>
                </div>
                <span>Prepared locally · not sent</span>
              </div>
              <div className="team-update-grid">
                {plan.approval.updates.map((update) => (
                  <article
                    key={update.role}
                    aria-label={`${update.role} update`}
                  >
                    <div className="team-role">
                      <span>{update.role}</span>
                      <button
                        className="secondary-button"
                        onClick={() => copy(update.role, update.body)}
                        aria-label={`Copy update for ${update.role.toLowerCase()}`}
                      >
                        <Clipboard size={15} /> Copy update
                      </button>
                    </div>
                    <h4>{update.title}</h4>
                    <p className="team-update-body">{update.body}</p>
                  </article>
                ))}
              </div>
              <p className="copy-notice" role="status">
                {copyNotice}
              </p>
            </section>
          )}
          <p className="plan-footnote">
            Synthetic scenario · Evidence-backed demo rules, not a validated
            ground model or a safety clearance.
          </p>
        </>
      )}
    </section>
  );
}
