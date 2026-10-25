import type { Evaluation, Readiness, Site } from "./types";

async function json<T>(
  url: string,
  signal: AbortSignal,
  body?: object,
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
  if (!response.ok)
    throw new Error(
      response.status === 503
        ? "The local site data is unavailable. Seed the demo and try again."
        : "Site data could not be loaded. Check the local API and try again.",
    );
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
