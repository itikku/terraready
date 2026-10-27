import type {
  CameraView,
  Approval,
  AssistRun,
  Evaluation,
  Readiness,
  RecoveryPlan,
  ShiftPlan,
  Site,
  SystemEvidence,
  WorkSuggestionResponse,
} from "./types";

async function json<T>(
  url: string,
  signal: AbortSignal,
  body?: object,
  context:
    | "site"
    | "plan"
    | "approval"
    | "assist"
    | "system"
    | "selection"
    | "suggestion" = "site",
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
    if (context === "suggestion")
      throw new Error(
        response.status === 409
          ? "The shift or your draft changed. Check this suggestion again against the current work."
          : response.status === 429
            ? "The local model is busy. Try again when the current analysis finishes. Your work choices are unchanged."
            : response.status === 422
              ? "This suggestion or draft is outside the supported planning inputs. Check the request and current assignments."
              : "The suggestion could not be checked. Try again; your work choices are unchanged.",
      );
    if (context === "selection" && response.status === 422)
      throw new Error(
        "These choices exceed a resource limit or include work that cannot start. Adjust the assignments and check again.",
      );
    if (context === "system")
      throw new Error(
        "System status could not be checked. The evidence workspace remains available; retry this local check.",
      );
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
    if (context === "assist")
      throw new Error(
        "Local analysis could not be loaded. Retry, or use the manual route review above.",
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

export const askAssistant = (
  question: string,
  signal: AbortSignal,
  asOf?: string,
) =>
  json<AssistRun>(
    "/api/scenarios/post-rain/assist",
    signal,
    { question, ...(asOf ? { as_of: asOf } : {}) },
    "assist",
  );

export async function reviewAssistance(
  run: AssistRun,
  signal: AbortSignal,
  asOf?: string,
) {
  const source = await json<RecoveryPlan>(
    `/api/scenarios/post-rain/recovery${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""}`,
    signal,
    undefined,
    "plan",
  );
  if (source.id !== run.source_plan_id)
    throw new Error(
      "The shift changed since this analysis. Run analysis again before reviewing.",
    );
  return json<RecoveryPlan>(
    "/api/scenarios/post-rain/recovery/evaluate",
    signal,
    { candidate_ids: run.candidate_ids, ...(asOf ? { as_of: asOf } : {}) },
    "plan",
  );
}

export const approveRecovery = (plan: RecoveryPlan, signal: AbortSignal) =>
  json<Approval>(
    "/api/scenarios/post-rain/recovery/approvals",
    signal,
    {
      plan_id: plan.id,
      candidate_ids: plan.selected_candidate_ids,
      as_of: plan.as_of,
    },
    "approval",
  );

export const getRecovery = (signal: AbortSignal, asOf?: string) =>
  json<RecoveryPlan>(
    `/api/scenarios/post-rain/recovery${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""}`,
    signal,
    undefined,
    "plan",
  );

export const evaluateRecovery = (
  candidateIds: string[],
  signal: AbortSignal,
  asOf?: string,
) =>
  json<RecoveryPlan>(
    "/api/scenarios/post-rain/recovery/evaluate",
    signal,
    { candidate_ids: candidateIds, ...(asOf ? { as_of: asOf } : {}) },
    "selection",
  );

export const getSystemEvidence = (signal: AbortSignal) =>
  json<SystemEvidence>("/api/system", signal, undefined, "system");

export const checkWorkSuggestion = (
  body: {
    task_id: string;
    suggestion: string;
    source_plan_id: string;
    current_candidate_ids: string[];
    as_of: string;
  },
  signal: AbortSignal,
) =>
  json<WorkSuggestionResponse>(
    "/api/scenarios/post-rain/suggestions",
    signal,
    body,
    "suggestion",
  );

export const getCamera = (zoneId: string, signal: AbortSignal) =>
  json<CameraView>(
    `/api/scenarios/post-rain/zones/${encodeURIComponent(zoneId)}/camera`,
    signal,
  );
