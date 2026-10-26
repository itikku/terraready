import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const panel = (page: Page) =>
  page.getByRole("region", { name: "Check the shift with the local model" });
const result = (page: Page) => panel(page).getByLabel("Local analysis result");
const choices = (page: Page) =>
  page.getByRole("region", { name: "Choose this shift's work" });
async function question(page: Page, text: string) {
  const details = panel(page).locator("details.assessment-question");
  if ((await details.getAttribute("open")) === null)
    await details.getByText("Ask a specific question").click();
  await panel(page).getByLabel("Question for the local assistant").fill(text);
}
async function analyze(page: Page, prompt = "Reroute") {
  const details = panel(page).locator("details.assessment-question");
  if ((await details.getAttribute("open")) === null)
    await details.getByText("Ask a specific question").click();
  await panel(page).getByRole("button", { name: prompt, exact: true }).click();
  await panel(page)
    .getByRole("button", { name: "Assess this shift", exact: true })
    .click();
  await expect(result(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  execFileSync(".venv/bin/python", ["scripts/reset_browser_approvals.py"]);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
  await page.goto("/");
  await expect(panel(page)).toBeVisible();
});

test("first screen pairs a concise work list with the map and preserves explicit decisions", async ({
  page,
}, info) => {
  await expect(
    page.getByRole("heading", { name: "What can keep moving after the rain?" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".condition-brief")
      .getByText("18 mm of rain overnight.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Assess this shift", exact: true }),
  ).toBeEnabled();
  await expect(choices(page)).toBeHidden();
  await expect(page.getByLabel("Site workspace", { exact: true })).toBeHidden();
  const map = page.getByRole("region", { name: "Shift map", exact: true });
  await expect(map).toBeVisible();
  const list = panel(page).getByLabel("Shift work list");
  await expect(list.getByRole("button")).toHaveCount(7);
  const left = await page.locator(".shift-column").boundingBox();
  const right = await map.boundingBox();
  expect(right!.width / left!.width).toBeGreaterThan(1.8);
  expect(right!.x).toBeGreaterThan(left!.x + left!.width);
  await page.screenshot({
    path: info.outputPath("guided-desktop.png"),
    fullPage: true,
  });
  const current = list.getByRole("button", {
    name: /Haul material from east cut/,
  });
  await current.click();
  await current.click();
  await expect(map.getByText("Checking…", { exact: true })).toHaveCount(0);
  await expect(map.getByText("Show the math", { exact: true })).toBeVisible();
  await list
    .getByRole("button", { name: /Inspect west stockpile ground/ })
    .click();
  await expect(
    map.getByRole("heading", { name: "West stockpile", exact: true }),
  ).toBeVisible();
  await map
    .getByRole("button", { name: "Inspect North access road", exact: true })
    .click();
  await expect(
    map.getByRole("heading", { name: "North access road", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Compare routes for original work" }),
  ).toBeHidden();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  const button = await page
    .getByRole("button", { name: "Assess this shift", exact: true })
    .boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("guided-mobile.png"),
    fullPage: true,
  });
});

test("model analysis leads to editable work and one explicit approval with the user's selection", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await analyze(page);
  await expect(
    result(page).getByText("TEST STUB · not real inference", { exact: true }),
  ).toBeVisible();
  const option = result(page).getByRole("button", {
    name: /Haul material from east cut South access/,
  });
  await expect(option).toBeVisible();
  await option.click();
  await option.click();
  await expect(
    page
      .getByRole("region", { name: "Shift map", exact: true })
      .getByText("Checking…", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Selected work on map")).toContainText(
    "South access → east cut",
  );
  await result(page)
    .getByText("Evidence and model trace", { exact: true })
    .click();
  await expect(
    result(page).getByText(/Audit saved in local LanceDB/),
  ).toBeVisible();
  await expect(
    result(page).getByText("evaluate_candidates", { exact: true }),
  ).toBeVisible();
  await expect(
    result(page).getByText("finish_analysis", { exact: true }),
  ).toBeVisible();
  await expect(panel(page).getByRole("checkbox")).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "Choose work to approve" })
    .click();
  await expect(panel(page)).toBeHidden();
  await choices(page)
    .getByLabel("Decision for Clear service-yard drainage trench", {
      exact: true,
    })
    .selectOption("");
  await choices(page)
    .getByRole("button", { name: "Review 3 assignments", exact: true })
    .click();
  const approve = choices(page).getByRole("button", {
    name: "Approve these 3 assignments",
  });
  await expect(approve).toBeDisabled();
  await choices(page).getByRole("checkbox").check();
  await approve.click();
  await expect(
    choices(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
  await choices(page)
    .getByRole("button", { name: "Copy haul coordinator brief" })
    .click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("South access");
  expect(clipboard).toContain("HOLD Verify west-stockpile layout");
  expect(clipboard).not.toContain("Clear service-yard drainage trench · EX-01");
  expect(clipboard).toContain("Nothing sent or dispatched");
  await page.reload();
  await expect(
    choices(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
});

test("focused questions explain backlog and held prerequisites without choosing or approving work", async ({
  page,
}) => {
  await analyze(page, "Redeploy");
  await result(page).getByText("Why this option?", { exact: true }).click();
  await expect(
    result(page).getByText(/pull forward ready backlog/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Ask another question" })
    .click();
  await analyze(page, "Blocked work");
  await result(page).getByText("Why this option?", { exact: true }).click();
  await expect(
    result(page).getByText(/Unfinished prerequisites: west-inspection/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Choose work to approve" })
    .click();
  await expect(
    choices(page).getByLabel("Decision for Verify west-stockpile layout", {
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    choices(page).getByRole("button", {
      name: "Review 4 assignments",
      exact: true,
    }),
  ).toBeVisible();
});

test("inference outage is explicit and manual choices stay available", async ({
  page,
}) => {
  await question(page, "Simulate runtime outage");
  await panel(page)
    .getByRole("button", { name: "Assess this shift", exact: true })
    .click();
  await expect(
    result(page).getByText("Rules-only fallback · model did not finish", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    result(page).getByText(/Inference outcome: unavailable/),
  ).toBeVisible();
  await result(page)
    .getByText("Evidence and model trace", { exact: true })
    .click();
  await expect(
    result(page).getByText(/No model tools completed/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Choose work to approve" })
    .click();
  await expect(
    choices(page).getByRole("button", {
      name: "Review 4 assignments",
      exact: true,
    }),
  ).toBeEnabled();
});

test("malformed model output cannot become an AI answer or approval", async ({
  page,
}) => {
  await question(page, "Simulate malformed output");
  await panel(page)
    .getByRole("button", { name: "Assess this shift", exact: true })
    .click();
  await expect(
    result(page).getByText(/Inference outcome: invalid_output/),
  ).toBeVisible();
  await expect(page.getByLabel("Approved shift recovery briefs")).toHaveCount(
    0,
  );
});

test("loading, cancellation and failed API retry discard stale results", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/scenarios/post-rain/assist", async (route) => {
    await gate;
    await route.continue();
  });
  await panel(page)
    .getByRole("button", { name: "Assess this shift", exact: true })
    .click();
  await expect(panel(page).getByRole("status")).toContainText(
    "Reading the shift",
  );
  await expect(page.locator(".assessment-skeleton")).toBeVisible();
  await panel(page).getByRole("button", { name: "Stop waiting" }).click();
  release();
  await expect(panel(page).getByRole("status")).toContainText(
    "Stopped waiting",
  );
  await expect(result(page)).toHaveCount(0);
  await page.unroute("**/api/scenarios/post-rain/assist");
  await page.route(
    "**/api/scenarios/post-rain/assist",
    (route) => route.fulfill({ status: 503, body: "{}" }),
    { times: 1 },
  );
  await panel(page)
    .getByRole("button", { name: "Assess this shift", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "Local analysis could not be loaded",
  );
  await analyze(page);
});

test("clock changes clear prior analysis and expired evidence cannot be approved", async ({
  page,
}) => {
  await page.route("**/api/scenarios/post-rain/assist", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, saved_locally: false } });
  });
  await analyze(page);
  await result(page)
    .getByText("Evidence and model trace", { exact: true })
    .click();
  await expect(result(page).getByText(/Audit NOT saved/)).toBeVisible();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByLabel("Evidence clock").selectOption("expired");
  await expect(result(page)).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "Choose work without the model" })
    .click();
  await expect(
    choices(page).getByRole("button", {
      name: "Review 0 assignments",
      exact: true,
    }),
  ).toBeDisabled();
});

test("keyboard and browser back navigation preserve a clear task and the user's choices", async ({
  page,
}) => {
  await panel(page)
    .getByRole("button", { name: "Choose work without the model" })
    .focus();
  await page.keyboard.press("Enter");
  const drainage = choices(page).getByLabel(
    "Decision for Clear service-yard drainage trench",
    { exact: true },
  );
  await drainage.selectOption("");
  await page.getByRole("link", { name: "Site evidence", exact: true }).click();
  await expect(
    page.getByLabel("Site workspace", { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(drainage).toHaveValue("");
  await expect(
    choices(page).getByRole("button", {
      name: "Review 3 assignments",
      exact: true,
    }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("unavailable candidate details never silently map a checked reroute to the baseline", async ({
  page,
}) => {
  await page.route("**/api/scenarios/post-rain/recovery", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
  await page.reload();
  await analyze(page);
  await expect(result(page).getByRole("status")).toContainText(
    "Map details for these options could not be loaded",
  );
  await expect(
    result(page).getByRole("button", { name: /Haul material from east cut/ }),
  ).toBeDisabled();
  await expect(page.getByLabel("Selected work on map")).toContainText(
    "North access → east cut",
  );
  await expect(
    result(page).getByRole("button", { name: "Choose work to approve" }),
  ).toBeEnabled();
});
