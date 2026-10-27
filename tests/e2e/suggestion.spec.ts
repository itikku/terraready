import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type {
  SolverCaseResult,
  WorkSuggestionResponse,
} from "../../apps/web/src/types";

type RequestBody = {
  task_id: string;
  source_plan_id: string;
  current_candidate_ids: string[];
  as_of: string;
  suggestion: string;
};
const work = (page: Page) => page.getByLabel("Shift work list");
const composer = (page: Page) => page.locator(".work-suggestion");
const result = (page: Page) =>
  page.getByLabel("Suggestion result", { exact: true });
const submit = (page: Page) =>
  composer(page).getByRole("button", { name: "Check suggestion", exact: true });
async function enter(
  page: Page,
  text = "Could we finish with two trucks and no overtime?",
) {
  if ((await composer(page).getAttribute("open")) === null)
    await composer(page).getByText("Suggest a change", { exact: true }).click();
  await composer(page).getByRole("textbox").fill(text);
  await expect(submit(page)).toBeEnabled();
}

// Deliberately synthetic protocol fixture. Solver correctness is tested against real CP-SAT in Python.
function reply(
  body: RequestBody,
  status: WorkSuggestionResponse["interpretation"]["status"] = "interpreted",
): WorkSuggestionResponse {
  const item = (
    kind: SolverCaseResult["case"],
    fleet: number,
    volume: number,
    finish: number,
    overtime: number,
  ): SolverCaseResult => ({
    case: kind,
    status: "feasible",
    solver_status: "OPTIMAL",
    message: "Synthetic checked alternative.",
    fleet,
    delivered_bank_m3: volume,
    finish_minutes: finish,
    overtime_minutes: overtime,
    additional_resources_required: fleet - 1,
    objective: kind,
    objective_value: finish,
    objective_bound: finish,
    verified: true,
    conflicts: [],
    trips: [],
    schedule: [
      {
        id: `fixture-${kind}`,
        task_id: body.task_id,
        resource_id: "loaded-hauler",
        kind: "truck_cycle",
        start_minutes: 0,
        end_minutes: finish,
      },
    ],
  });
  return {
    task_id: body.task_id,
    source_plan_id: body.source_plan_id,
    planning_only: true,
    interpretation: {
      status,
      task_id: body.task_id,
      intent:
        status === "interpreted"
          ? {
              target_bank_m3: 320,
              max_trucks: 2,
              max_overtime_minutes: 0,
              deadline_minutes: null,
              keep_other_work: true,
            }
          : null,
      message:
        status === "interpreted"
          ? "Test interpretation: retain other work, use at most two trucks and no overtime."
          : "Specify a supported planning assumption. No work choices changed.",
      model_id: "frontend-protocol-fixture",
      mode: "test_stub",
      elapsed_ms: 1,
      completion_tokens: 0,
      trace: [],
    },
    solver:
      status !== "interpreted"
        ? null
        : {
            id: "1".repeat(64),
            task_id: body.task_id,
            source_plan_id: body.source_plan_id,
            as_of: body.as_of,
            review_by: "2026-10-24T08:00:00-07:00",
            ground_status: "GO",
            ground_reasons: [],
            verdict: "NO_GO",
            solver: "CP-SAT protocol fixture",
            solver_workers: 1,
            read_only: true,
            inputs: {
              production: {
                version: "production-demo-v1",
                synthetic: true,
                description: "Synthetic browser protocol data only.",
                haul_task_id: "east-haul",
                preparation_task_id: "east-excavate",
                drainage_task_id: "yard-drainage",
                loader_machine_id: "tracked-excavator",
                truck_machine_id: "loaded-hauler",
                route_id: "south-to-east",
                payload_loose_m3: 20,
                swell_factor: 1.25,
                bank_m3_per_load: 16,
                load_minutes: 8,
                loaded_travel_minutes: 6,
                dump_minutes: 2,
                return_minutes: 4,
                shift_minutes: 480,
                existing_trucks: 1,
                maximum_trucks: 3,
                default_trucks: 2,
                target_bank_m3: 320,
                maximum_loads: 20,
              },
              target_bank_m3: 320,
              max_trucks: 2,
              max_overtime_minutes: 0,
              deadline_minutes: null,
              keep_other_work: true,
              retained_task_ids: [],
              preparation_minutes: 180,
              drainage_minutes: 120,
              shift_minutes: 480,
              include_haul: true,
              jobs: [],
              resource_minutes: { "tracked-excavator": 480 },
            },
            requested: {
              ...item("requested", 2, 320, 480, 0),
              status: "infeasible",
              solver_status: "INFEASIBLE",
              message: "Fleet, volume and shift constraints conflict.",
              verified: false,
              fleet: null,
              delivered_bank_m3: null,
              finish_minutes: null,
              overtime_minutes: null,
              additional_resources_required: 0,
              conflicts: ["At most two trucks", "No overtime"],
              schedule: [],
            },
            alternatives: [
              item("minimum_fleet", 3, 320, 450, 0),
              item("minimum_overtime", 2, 320, 495, 15),
              item("maximum_volume", 2, 272, 465, 0),
            ],
            assumptions: [
              "Synthetic travel and service times; confirm before field use.",
            ],
          },
  };
}

test.beforeEach(async ({ page }) => {
  execFileSync(".venv/bin/python", ["scripts/reset_browser_approvals.py"]);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
  await page.goto("/");
  await expect(work(page).getByRole("button")).toHaveCount(7);
});

test("per-item what-if retains map/list while checking and shows separate checked alternatives without approval", async ({
  page,
}, info) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent: RequestBody | null = null;
  let approvals = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/approvals") && request.method() === "POST")
      approvals++;
  });
  await page.route("**/suggestions", async (route) => {
    sent = route.request().postDataJSON();
    await waiting;
    await route.fulfill({ json: reply(sent!) });
  });
  await enter(page);
  await submit(page).click();
  await expect(composer(page).getByRole("status")).toContainText(
    "Interpreting",
  );
  await expect(work(page).getByRole("button")).toHaveCount(7);
  await expect(
    page.getByRole("region", { name: "Shift map", exact: true }),
  ).toBeVisible();
  await expect.poll(() => sent?.task_id).toBe("east-haul");
  release();
  await expect(
    result(page).getByRole("heading", {
      name: "NO-GO · request cannot proceed",
    }),
  ).toBeVisible();
  await expect(
    result(page).getByText("TEST STUB · not real inference", { exact: true }),
  ).toBeVisible();
  await expect(result(page).getByLabel("Checked alternatives")).toContainText(
    "272 bank m³",
  );
  await expect(result(page)).toContainText("hypothetical additional pair(s)");
  await expect(result(page)).toContainText(
    "20 loose m³/load ÷ 1.25 swell = 16 bank m³/load",
  );
  await expect(result(page)).toContainText(
    "does not certify future ground conditions",
  );
  await expect(composer(page)).toContainText(
    "does not change work choices or approve work",
  );
  expect(approvals).toBe(0);
  await expect(composer(page).getByRole("checkbox")).toHaveCount(0);
  await result(page)
    .getByText("Schedule, constraints and solver details", { exact: true })
    .click();
  await result(page)
    .getByText("Most material: schedule and proof", { exact: true })
    .click();
  await expect(result(page).getByRole("table")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("suggestion-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("suggestion-mobile.png"),
    fullPage: true,
  });
});

test("what-if binds the actual custom draft and checked fingerprint", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Choose work without the model" })
    .click();
  const decisions = page.getByRole("region", {
    name: "Choose this shift's work",
  });
  await decisions
    .getByLabel("Decision for Clear service-yard drainage trench", {
      exact: true,
    })
    .selectOption("");
  const excavation = decisions.getByLabel("Decision for Prepare east cut", {
    exact: true,
  });
  const routeId = await excavation
    .getByRole("option", { name: /EX-01.*South access/ })
    .getAttribute("value");
  await excavation.selectOption(routeId!);
  await page.getByRole("link", { name: "Assessment", exact: true }).click();
  let sent: RequestBody | null = null;
  await page.route("**/suggestions", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: reply(sent!, "clarification") });
  });
  await enter(page, "Can we finish the selected work earlier?");
  const evaluated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/recovery/evaluate") && response.ok(),
  );
  await submit(page).click();
  const checked = await (await evaluated).json();
  await expect(result(page)).toBeVisible();
  expect(sent!.source_plan_id).toBe(checked.id);
  expect(sent!.current_candidate_ids).toEqual(checked.selected_candidate_ids);
  expect(sent!.current_candidate_ids).toHaveLength(3);
  expect(sent!.current_candidate_ids).toContain(routeId);
  await page
    .getByRole("button", { name: "Choose work without the model" })
    .click();
  await expect(
    decisions.getByLabel("Decision for Clear service-yard drainage trench", {
      exact: true,
    }),
  ).toHaveValue("");
  await expect(decisions.getByRole("checkbox")).toHaveCount(0);
});

test("switching item cancels a late response and never attributes it to new work", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = false;
  await page.route("**/suggestions", async (route) => {
    sent = true;
    const body = route.request().postDataJSON();
    await waiting;
    await route.fulfill({ json: reply(body) }).catch(() => {});
  });
  await enter(page);
  await submit(page).click();
  await expect.poll(() => sent).toBe(true);
  await work(page)
    .getByRole("button", { name: /Inspect west stockpile ground/ })
    .click();
  release();
  await expect(result(page)).toHaveCount(0);
  await enter(page, "Can this held inspection proceed?");
  await expect(composer(page).getByRole("form")).toHaveAccessibleName(
    "Suggestion for Inspect west stockpile ground",
  );
  await expect(composer(page).getByRole("textbox")).toHaveValue(
    "Can this held inspection proceed?",
  );
});

for (const [status, title] of [
  ["clarification", "More detail needed"],
  ["unsupported", "Outside this demo's scope"],
  ["unavailable", "Local model unavailable"],
  ["timeout", "Model interpretation timed out"],
  ["invalid_output", "No valid interpretation"],
] as const) {
  test(`${status} remains distinct from mathematical infeasibility`, async ({
    page,
  }) => {
    await page.route("**/suggestions", (route) =>
      route.fulfill({ json: reply(route.request().postDataJSON(), status) }),
    );
    await enter(page);
    await submit(page).click();
    await expect(
      result(page).getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      result(page).getByRole("heading", { name: /NO-GO|GO ·/ }),
    ).toHaveCount(0);
    await expect(result(page).getByLabel("Checked alternatives")).toHaveCount(
      0,
    );
  });
}

test("input edits and draft edits clear stale outcomes; API failure is recoverable", async ({
  page,
}) => {
  await page.route("**/suggestions", (route) =>
    route.fulfill({ status: 429, json: { detail: "busy" } }),
  );
  await enter(page);
  await submit(page).click();
  await expect(composer(page).getByRole("alert")).toContainText(
    "local model is busy",
  );
  await page.unroute("**/suggestions");
  await page.route("**/suggestions", (route) =>
    route.fulfill({ json: reply(route.request().postDataJSON()) }),
  );
  await submit(page).click();
  await expect(result(page)).toBeVisible();
  await composer(page)
    .getByRole("textbox")
    .fill("Change the requested quantity.");
  await expect(result(page)).toHaveCount(0);
  await submit(page).click();
  await expect(result(page)).toBeVisible();
  await page
    .getByRole("button", { name: "Choose work without the model" })
    .click();
  await page
    .getByLabel("Decision for Clear service-yard drainage trench", {
      exact: true,
    })
    .selectOption("");
  await page.getByRole("link", { name: "Assessment", exact: true }).click();
  await expect(result(page)).toHaveCount(0);
  await expect(composer(page).getByRole("textbox")).toHaveValue(
    "Change the requested quantity.",
  );
  await expect(composer(page).getByRole("status")).toContainText(
    "work choices changed",
  );
});

test("keyboard submission can be cancelled without showing a late result", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = false;
  await page.route("**/suggestions", async (route) => {
    sent = true;
    const body = route.request().postDataJSON();
    await waiting;
    await route.fulfill({ json: reply(body) }).catch(() => {});
  });
  await enter(page);
  await composer(page).getByRole("textbox").press("Tab");
  await expect(submit(page)).toBeFocused();
  await submit(page).press("Enter");
  await expect.poll(() => sent).toBe(true);
  await composer(page)
    .getByRole("button", { name: "Stop waiting", exact: true })
    .click();
  release();
  await expect(composer(page).getByRole("status")).toContainText(
    "Stopped waiting",
  );
  await expect(submit(page)).toBeEnabled();
  await expect(result(page)).toHaveCount(0);
});

test("a changed evidence clock invalidates the what-if", async ({ page }) => {
  await page.route("**/suggestions", (route) =>
    route.fulfill({ json: reply(route.request().postDataJSON()) }),
  );
  await enter(page);
  await submit(page).click();
  await expect(result(page)).toBeVisible();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByLabel("Evidence clock").selectOption("expired");
  await expect(result(page)).toHaveCount(0);
  await expect(composer(page).getByRole("textbox")).toBeHidden();
});

test("typing before the draft arrives keeps the editor and suggestion intact", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/recovery", async (route) => {
    const response = await route.fetch();
    await waiting;
    await route.fulfill({ response });
  });
  await page.reload();
  await composer(page).getByText("Suggest a change", { exact: true }).click();
  await composer(page)
    .getByRole("textbox")
    .fill("Please retain this while my draft loads.");
  await expect(submit(page)).toBeDisabled();
  release();
  await expect(submit(page)).toBeEnabled();
  await expect(composer(page).getByRole("textbox")).toHaveValue(
    "Please retain this while my draft loads.",
  );
});

test("unproven or mismatched results never show a green go", async ({
  page,
}) => {
  let mismatch = false;
  await page.route("**/suggestions", (route) => {
    const body = route.request().postDataJSON();
    const response = reply(body);
    if (mismatch) response.task_id = "west-inspection";
    else {
      response.solver!.verdict = "GO";
      response.solver!.requested.status = "feasible";
      response.solver!.requested.solver_status = "FEASIBLE";
      response.solver!.requested.verified = false;
    }
    return route.fulfill({ json: response });
  });
  await enter(page);
  await submit(page).click();
  await expect(
    result(page).getByRole("heading", {
      name: "No proven result",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    result(page).getByRole("heading", {
      name: "GO · planning feasible",
      exact: true,
    }),
  ).toHaveCount(0);
  mismatch = true;
  await submit(page).click();
  await expect(composer(page).getByRole("alert")).toContainText(
    "did not match this item and draft",
  );
  await expect(result(page)).toHaveCount(0);
});
