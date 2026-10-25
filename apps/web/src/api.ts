import type { Approval, Evaluation, Readiness, ShiftPlan, Site } from "./types";

async function json<T>(
  url: string,
  signal: AbortSignal,
  body?: object,
  context: "site" | "plan" | "approval" = "site",
): Promise<T> {
  const response = await fetch(url, {
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    if (response.status === 409)
      throw new Error(
        "This proposal changed or no work is eligible. Refresh the plan and review again.",
      );
    if (context === "approval")
      throw new Error(
        "Local approval could not be confirmed. Retry safely; nothing was dispatched.",
      );
    if (context === "plan")
      throw new Error(
        "Plan comparison unavailable. Check the local API and retry.",
      );
    throw new Error(
      response.status === 503
        ? "The local site data is unavailable. Seed the demo and try again."
        : "Site data could not be loaded. Check the local API and try again.",
    );
  }
  return response.json() as Promise<T>;
}
export const getSite = (signal: AbortSignal) =>
  json<Site>("/api/scenarios/post-rain", signal);
export const getReadiness = (
  machine: string,
  signal: AbortSignal,
  asOf?: string,
) =>
  json<Readiness>(
    `/api/scenarios/post-rain/readiness?machine_id=${encodeURIComponent(machine)}${asOf ? `&as_of=${encodeURIComponent(asOf)}` : ""}`,
    signal,
  );
export const getEvaluation = (
  task: string,
  machine: string,
  route: string,
  signal: AbortSignal,
  asOf?: string,
) =>
  json<Evaluation>("/api/scenarios/post-rain/evaluate", signal, {
    task_id: task,
    machine_id: machine,
    route_id: route,
    ...(asOf ? { as_of: asOf } : {}),
  });
export const getPlan = (signal: AbortSignal, asOf?: string) =>
  json<ShiftPlan>(
    `/api/scenarios/post-rain/plan${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""}`,
    signal,
    undefined,
    "plan",
  );
export const approvePlan = (id: string, signal: AbortSignal, asOf?: string) =>
  json<Approval>(
    "/api/scenarios/post-rain/approvals",
    signal,
    { plan_id: id, ...(asOf ? { as_of: asOf } : {}) },
    "approval",
  );
