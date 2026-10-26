import type { Calculation, ZoneDecision } from "./types";

const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
function equation(check: Calculation) {
  if (check.observed === null || check.headroom === null)
    return "Measurement missing";
  const unit =
    check.unit === "degrees"
      ? "°"
      : check.unit === "fraction"
        ? ""
        : ` ${check.unit}`;
  if (check.code === "EVIDENCE_AGE")
    return `${number(check.observed)} ≤ ${number(check.limit)} hours`;
  if (check.code === "POST_RAIN")
    return `${number(check.observed)} ≥ ${number(check.limit)} hours after rain`;
  if (check.code === "CONFIDENCE")
    return `${number(check.observed)} ≥ ${number(check.limit)}`;
  const [left, right] =
    check.code === "BEARING"
      ? [check.observed, check.limit]
      : [check.limit, check.observed];
  return `${number(left)} − ${number(right)} = ${number(check.headroom)}${unit}`;
}

export default function MathChecks({
  decision,
  clock,
  pending = false,
}: {
  decision: ZoneDecision | null;
  pending?: boolean;
  clock: string;
}) {
  return (
    <details className="math-checks">
      <summary>Show the math</summary>
      <p>
        Calculated by code, independently of the model. Synthetic demo limits; a
        passing margin alone does not release work.
      </p>
      {pending && <p role="status">Checking the current values…</p>}
      <dl>
        {(decision?.calculations ?? []).map((check, index) => (
          <div key={`${check.code}-${check.evidence_id}-${index}`}>
            <dt>{check.label}</dt>
            <dd>
              <code>{equation(check)}</code>
              <span className={`math-outcome ${check.outcome}`}>
                {check.outcome === "pass"
                  ? "Pass"
                  : check.outcome === "blocked"
                    ? "Blocked"
                    : check.outcome === "inspect"
                      ? "Inspect"
                      : "Unavailable"}
              </span>
            </dd>
            {check.caution_limit !== null &&
              check.caution_limit !== undefined && (
                <dd className="math-evidence">
                  Inspection band starts at {number(check.caution_limit)}{" "}
                  moisture fraction.
                </dd>
              )}
            {check.evidence_id && (
              <dd className="math-evidence">
                {check.evidence_id}
                {!check.applicable && " · cannot support release"}
              </dd>
            )}
          </div>
        ))}
      </dl>
      <p>
        Evidence clock: {new Date(clock).toISOString()}. Display rounded to
        three decimals; decisions use the original values. Limits are strict for
        bearing, moisture and slope; evidence must also be fresh, trusted and
        post-rain.
      </p>
      {!pending && (!decision || decision.calculations?.length === 0) && (
        <p>Calculation details are unavailable on this build.</p>
      )}
    </details>
  );
}
