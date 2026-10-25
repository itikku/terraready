import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const panel = (page: Page) =>
  page.getByRole("region", { name: "Ask about the recovery." });
const result = (page: Page) => panel(page).getByLabel("Local analysis result");
async function analyze(page: Page, prompt = "Reroute") {
  await panel(page).getByRole("button", { name: prompt, exact: true }).click();
  await panel(page)
    .getByRole("button", { name: "Analyze locally", exact: true })
    .click();
  await expect(result(page)).toBeVisible();
}
async function review(page: Page) {
  await panel(page)
    .getByRole("button", { name: "Review these recovery options" })
    .click();
  await expect(
    panel(page).getByRole("heading", {
      name: "Human review · selected recovery",
    }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  execFileSync(".venv/bin/python", ["scripts/reset_browser_approvals.py"]);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
  await page.goto("/");
  await expect(panel(page)).toBeVisible();
});

test("protocol stub tools reach grounded review, real approval and teammate copy", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await analyze(page);
  await expect(
    result(page).getByText("TEST STUB · not real inference", { exact: true }),
  ).toBeVisible();
  await expect(result(page).getByText(/South access/)).toBeVisible();
  await expect(
    result(page).getByText(/Audit saved in local LanceDB/),
  ).toBeVisible();
  await result(page)
    .getByText(/Observable tool trace/)
    .click();
  await expect(
    result(page).getByText("evaluate_candidates", { exact: true }),
  ).toBeVisible();
  await expect(
    result(page).getByText("finish_analysis", { exact: true }),
  ).toBeVisible();
  await review(page);
  const approve = panel(page).getByRole("button", {
    name: "Approve selected recovery",
  });
  await expect(approve).toBeDisabled();
  await expect(panel(page).getByText(/west-inspection/)).toBeVisible();
  await panel(page).getByRole("checkbox").check();
  await approve.click();
  await expect(
    panel(page).getByLabel("Approved recovery updates"),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Copy Haul coordinator recovery update" })
    .click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("South access");
  expect(clipboard).toContain("HOLD Verify west-stockpile layout");
  expect(clipboard).toContain("Nothing sent or dispatched");
  const violations = await new AxeBuilder({ page }).analyze();
  expect(violations.violations).toEqual([]);
  await panel(page).screenshot({ path: "docs/images/local-assistant.png" });
  // No autoapproval; the same explicit selection returns its durable approval.
  await page.reload();
  await analyze(page);
  await review(page);
  await expect(
    panel(page).getByLabel("Approved recovery updates"),
  ).toBeVisible();
});

test("ready backlog is a separate resource choice and blocked successor never becomes work", async ({
  page,
}) => {
  await analyze(page, "Redeploy");
  await expect(
    result(page).getByText(/pull forward ready backlog/),
  ).toBeVisible();
  await review(page);
  await expect(
    page
      .getByRole("region", { name: "Human review · selected recovery" })
      .getByText(/2h planned effort/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Blocked work", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Analyze locally", exact: true })
    .click();
  await expect(
    result(page).getByText(/Unfinished prerequisites: west-inspection/),
  ).toBeVisible();
  await review(page);
  await expect(
    panel(page).getByText(
      "No eligible work selected. Nothing can be approved.",
    ),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Approve selected recovery" }),
  ).toBeDisabled();
});

test("inference outage is explicit rules-only fallback and retry can recover", async ({
  page,
}) => {
  await panel(page)
    .getByLabel("Question for the local assistant")
    .fill("Simulate runtime outage");
  await panel(page)
    .getByRole("button", { name: "Analyze locally", exact: true })
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
    .getByText(/Observable tool trace/)
    .click();
  await expect(
    result(page).getByText(/No model tools completed/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keep the work. Change the plan." }),
  ).toBeVisible();
  await analyze(page);
  await expect(
    result(page).getByText("TEST STUB · not real inference", { exact: true }),
  ).toBeVisible();
});

test("malformed model output cannot become an AI answer or an approval", async ({
  page,
}) => {
  await panel(page)
    .getByLabel("Question for the local assistant")
    .fill("Simulate malformed output");
  await panel(page)
    .getByRole("button", { name: "Analyze locally", exact: true })
    .click();
  await expect(
    result(page).getByText(/Inference outcome: invalid_output/),
  ).toBeVisible();
  await expect(panel(page).getByLabel("Approved recovery updates")).toHaveCount(
    0,
  );
});

test("loading, cancellation and failed API retry do not show stale results", async ({
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
    .getByRole("button", { name: "Analyze locally", exact: true })
    .click();
  await expect(panel(page).getByRole("status")).toContainText(
    "Reading the shift",
  );
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
  await analyzeClick(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Local analysis could not be loaded",
  );
  await analyze(page);
});
async function analyzeClick(page: Page) {
  await panel(page)
    .getByRole("button", { name: "Analyze locally", exact: true })
    .click();
}

test("snapshot changes invalidate analysis review and failed approval remains retryable", async ({
  page,
}) => {
  await analyze(page);
  await page.route(
    "**/api/scenarios/post-rain/recovery",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, id: "0".repeat(64) } });
    },
    { times: 1 },
  );
  await panel(page)
    .getByRole("button", { name: "Review these recovery options" })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText("shift changed");
  await review(page);
  await page.route(
    "**/api/scenarios/post-rain/recovery/approvals",
    (route) => route.fulfill({ status: 503, body: "{}" }),
    { times: 1 },
  );
  await panel(page).getByRole("checkbox").check();
  await panel(page)
    .getByRole("button", { name: "Approve selected recovery" })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "approval could not be confirmed",
  );
  await expect(panel(page).getByLabel("Approved recovery updates")).toHaveCount(
    0,
  );
  await panel(page)
    .getByRole("button", { name: "Approve selected recovery" })
    .click();
  await expect(
    panel(page).getByLabel("Approved recovery updates"),
  ).toBeVisible();
});

test("clock changes clear old analysis and unpersisted audits are labeled", async ({
  page,
}) => {
  await page.route("**/api/scenarios/post-rain/assist", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, saved_locally: false } });
  });
  await analyze(page);
  await expect(result(page).getByText(/Audit NOT saved/)).toBeVisible();
  await page.getByLabel("Evidence clock").selectOption("expired");
  await expect(result(page)).toHaveCount(0);
  await panel(page)
    .getByLabel("Question for the local assistant")
    .fill("Simulate runtime outage");
  await analyzeClick(page);
  await review(page);
  await expect(
    panel(page).getByText(
      "No eligible work selected. Nothing can be approved.",
    ),
  ).toBeVisible();
});

test("mobile analysis and keyboard review remain readable and accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await analyze(page, "Redeploy");
  await review(page);
  const checkbox = panel(page).getByRole("checkbox");
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await panel(page).screenshot({
    path: "docs/images/local-assistant-mobile.png",
  });
});
