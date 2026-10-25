import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";

test.beforeEach(async ({ page }) => {
  execFileSync(".venv/bin/python", ["scripts/reset_browser_approvals.py"]);
  // The complete core experience must work with every non-local request blocked.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
  await page.goto("/");
});

test("local aerial, evidence and route are available without external connectivity", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Recover today's shift" }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("No-go", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Synthetic illustration of a rutted, waterlogged construction access road",
    }),
  ).toBeVisible();
  await expect(page.getByText("72%", { exact: true })).toBeVisible();
  await expect(page.getByText("USGS / USDA NAIP · May 2022")).toBeVisible();
  expect(
    await page
      .getByRole("img", { name: /rutted/ })
      .evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(1000);
  await expect(
    page.getByLabel("Site workspace", { exact: true }),
  ).toHaveScreenshot("site-workspace.png", { maxDiffPixelRatio: 0.03 });
  await page.screenshot({
    path: "docs/images/workspace-desktop.png",
    fullPage: true,
  });
});

test("zone selection exposes stale evidence instead of a green release", async ({
  page,
}) => {
  await page
    .getByLabel("Work zones", { exact: true })
    .getByRole("button", { name: /West stockpile/ })
    .click();
  const panel = page.getByLabel("Zone evidence");
  await expect(
    panel.getByRole("heading", { name: "West stockpile" }),
  ).toBeVisible();
  await expect(panel.getByText("Inspect", { exact: true })).toBeVisible();
  await expect(panel.getByText("Refresh required")).toBeVisible();
  await expect(panel.getByText(/predates the overnight rain/)).toBeVisible();
});

test("machine changes update readiness using backend decisions", async ({
  page,
}) => {
  await page.getByRole("button", { name: /EX-01 Tracked excavator/ }).click();
  const panel = page.getByLabel("Zone evidence");
  await expect(panel.getByText("Go", { exact: true })).toBeVisible();
  await expect(panel.getByText("Asset pressure 42 kPa")).toBeVisible();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("Go", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByRole("heading", { name: "Prepare east cut" }),
  ).toBeVisible();
});

test("manual route comparison changes a blocked haul to within-limits", async ({
  page,
}) => {
  await page.getByLabel("Access route").selectOption("south-to-east");
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("Go", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Within demo limits. Awaiting supervisor review."),
  ).toBeVisible();
});

test("clock expiry updates both map readiness and route result", async ({
  page,
}) => {
  await page.getByLabel("Evidence clock").selectOption("expired");
  await expect(
    page.getByLabel("Zone evidence").getByText("Inspect", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("Inspect", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Refresh required")).toBeVisible();
});

test("inspection image and provenance dialogs work with keyboard", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Enlarge synthetic inspection image" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Synthetic inspection image" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Data sources and provenance" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Every observation has a source." }),
  ).toBeVisible();
  await expect(page.getByText(/not a calibrated probability/)).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
});

test("map zones work with keyboard and overlays can be toggled", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Inspect East cut", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Zone evidence").getByRole("heading", { name: "East cut" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle readiness overlays" }).click();
  await expect(
    page.getByRole("button", { name: "Inspect East cut", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle readiness overlays" }).click();
  await expect(
    page.getByRole("button", { name: "Inspect East cut", exact: true }),
  ).toBeVisible();
});

test("provider failure returns to the local aerial without breaking analysis", async ({
  page,
}) => {
  const satellite = page.getByRole("button", { name: /Satellite/ });
  test.skip(
    await satellite.isDisabled(),
    "No optional token configured in this environment.",
  );
  await satellite.click();
  await expect(page.getByText(/Connected imagery unavailable/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Local aerial" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Access route").selectOption("south-to-east");
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("Go", { exact: true }),
  ).toBeVisible();
});

test("API load failure is actionable and retry recovers", async ({ page }) => {
  await page.route("**/api/scenarios/post-rain", (route) =>
    route.fulfill({ status: 503, json: { detail: "Unavailable" } }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Site workspace unavailable" }),
  ).toBeVisible();
  await page.unroute("**/api/scenarios/post-rain");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("No-go", { exact: true }),
  ).toBeVisible();
});

test("failed assessment does not leave a stale green decision visible", async ({
  page,
}) => {
  await page.getByLabel("Access route").selectOption("south-to-east");
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("Go", { exact: true }),
  ).toBeVisible();
  await page.route("**/evaluate", (route) =>
    route.fulfill({ status: 503, json: { detail: "Unavailable" } }),
  );
  await page.getByLabel("Access route").selectOption("north-to-east");
  await expect(
    page.getByText("Assessment unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("Go", { exact: true }),
  ).toHaveCount(0);
});

test("critical workspace passes accessibility checks", async ({ page }) => {
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("No-go", { exact: true }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("loading state persists until the snapshot arrives", async ({ page }) => {
  let resume: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route("**/api/scenarios/post-rain", async (route) => {
    await hold;
    await route.continue();
  });
  await page.reload();
  await expect(
    page.getByText("Opening the local site workspace…"),
  ).toBeVisible();
  resume();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("No-go", { exact: true }),
  ).toBeVisible();
});

test("missing inspection image falls back to honestly labeled aerial context", async ({
  page,
}) => {
  await page.route("**/imagery/north-inspection.png", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.reload();
  await expect(
    page.getByRole("img", {
      name: "Historical aerial context, not a current ground inspection",
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Zone evidence").getByText("No-go", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("HISTORICAL AERIAL CONTEXT", { exact: true }),
  ).toBeVisible();
});

test("mobile workspace remains usable without horizontal document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page
      .getByLabel("Zone evidence")
      .getByRole("heading", { name: "North access road" }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("No-go", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/images/workspace-mobile.png",
    fullPage: true,
  });
  await page
    .getByLabel("Work zones", { exact: true })
    .getByRole("button", { name: /South access road/ })
    .click();
  await expect(
    page.getByLabel("Zone evidence").getByText("Go", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
