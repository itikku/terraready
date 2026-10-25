import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const review = (page: Page) =>
  page.getByRole("region", { name: "Compare routes for original work" });
async function approve(page: Page) {
  await review(page).getByRole("checkbox").check();
  await review(page)
    .getByRole("button", { name: "Approve revised plan" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Approved locally. Ready to brief the team.",
    }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Fixed, disposable test DB; no reset or mutation of the user's running demo.
  execFileSync(".venv/bin/python", ["scripts/reset_browser_approvals.py"]);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
  await page.goto("/");
  await expect(
    review(page).getByText("Superintendent review", { exact: true }),
  ).toBeVisible();
});

test("proposal reroutes hauling, preserves priority work and explains route evidence", async ({
  page,
}) => {
  const haul = review(page).getByRole("article", {
    name: "Haul material from east cut plan",
  });
  await expect(
    haul.getByText("South access → east cut", { exact: true }),
  ).toBeVisible();
  await expect(haul.getByText("Hold · no-go", { exact: true })).toBeVisible();
  await expect(haul.getByText("Eligible now", { exact: true })).toBeVisible();
  await expect(review(page).getByText("Before 10:15 PDT")).toBeVisible();
  await expect(
    review(page).getByRole("button", { name: "Approve revised plan" }),
  ).toBeDisabled();
  await haul.getByText(/Why this recommendation/).click();
  await expect(haul.getByText(/Bearing capacity 65 kPa/)).toBeVisible();
  await review(page).getByText("Planning assumptions & limits").click();
  await expect(
    review(page).getByText(/Targets are not production forecasts/),
  ).toBeVisible();
  await expect(page.getByLabel("Approved teammate updates")).toHaveCount(0);
  await review(page).screenshot({ path: "docs/images/plan-review.png" });
});

test("approval saves real LanceDB state, holds remain held and both briefs survive reload", async ({
  page,
}) => {
  await approve(page);
  const field = page.getByRole("article", { name: "Field lead update" });
  const haul = page.getByRole("article", { name: "Haul coordinator update" });
  await expect(field.getByText(/verified safe access only/)).toBeVisible();
  await expect(field.getByText(/HOLD/)).toBeVisible();
  await expect(haul.getByText(/Replaces North access/)).toBeVisible();
  await expect(haul.getByText(/NO_GO for this machine/)).toBeVisible();
  await expect(
    review(page)
      .getByRole("article", { name: "Inspect west stockpile ground plan" })
      .getByText("Hold for field review"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Approved locally. Ready to brief the team.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Approved teammate updates")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  // Axe can leave the skip link focused; clear diagnostic focus before the artifact.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await review(page).screenshot({ path: "docs/images/approved-plan.png" });
});

test("copy and download contain the approved role-specific brief, never a sent claim", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await approve(page);
  await page
    .getByRole("button", { name: "Copy update for field lead" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Field lead update copied. Nothing was sent." }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "verified safe access only",
  );
  await page
    .getByRole("button", { name: "Copy update for haul coordinator" })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Replaces North access",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download shift brief" }).click();
  const file = await downloading;
  const contents = await readFile((await file.path())!, "utf8");
  expect(file.suggestedFilename()).toMatch(
    /^terraready-shift-[a-f0-9]{12}\.md$/,
  );
  expect(contents).toContain("## Field lead");
  expect(contents).toContain("## Haul coordinator");
  expect(contents).toContain("Nothing sent or dispatched.");
  expect(contents).toContain("HOLD");
  expect(contents).toContain("## Assumptions");
});

test("expired clock removes approval and prevents approving all-held work", async ({
  page,
}) => {
  await approve(page);
  await page.getByLabel("Evidence clock").selectOption("expired");
  await expect(
    review(page).getByRole("heading", {
      name: "All work is held. Get fresh evidence first.",
    }),
  ).toBeVisible();
  await expect(
    review(page).getByRole("button", { name: "Approve revised plan" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Approved teammate updates")).toHaveCount(0);
  await page.getByLabel("Evidence clock").selectOption("morning");
  await expect(
    page.getByRole("heading", {
      name: "Approved locally. Ready to brief the team.",
    }),
  ).toBeVisible();
});

test("failed approval never shows briefs, then safe retry succeeds", async ({
  page,
}) => {
  await page.route("**/approvals", (route) =>
    route.fulfill({ status: 503, json: { detail: "Unavailable" } }),
  );
  await review(page).getByRole("checkbox").check();
  await review(page)
    .getByRole("button", { name: "Approve revised plan" })
    .click();
  await expect(review(page).getByRole("alert")).toContainText(
    "Local approval could not be confirmed",
  );
  await expect(page.getByLabel("Approved teammate updates")).toHaveCount(0);
  await page.unroute("**/approvals");
  await review(page)
    .getByRole("button", { name: "Approve revised plan" })
    .click();
  await expect(page.getByLabel("Approved teammate updates")).toBeVisible();
});

test("stale proposal requires refresh and explicit review again", async ({
  page,
}) => {
  await page.route("**/approvals", (route) =>
    route.fulfill({ status: 409, json: { detail: "Changed" } }),
  );
  await review(page).getByRole("checkbox").check();
  await review(page)
    .getByRole("button", { name: "Approve revised plan" })
    .click();
  await expect(review(page).getByRole("alert")).toContainText(
    "proposal changed",
  );
  await page.unroute("**/approvals");
  await review(page).getByRole("button", { name: "Refresh plan" }).click();
  await expect(review(page).getByRole("checkbox")).not.toBeChecked();
  await expect(
    review(page).getByRole("button", { name: "Approve revised plan" }),
  ).toBeDisabled();
  await approve(page);
});

test("plan load failure recovers without affecting the map workspace", async ({
  page,
}) => {
  await page.route("**/plan", (route) =>
    route.fulfill({ status: 503, json: { detail: "Unavailable" } }),
  );
  await page.reload();
  await expect(review(page).getByRole("alert")).toBeVisible();
  await expect(
    page
      .getByLabel("Task and route assessment")
      .getByText("No-go", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/plan");
  await review(page)
    .getByRole("button", { name: "Retry plan comparison" })
    .click();
  await expect(review(page).getByRole("checkbox")).toBeVisible();
});

test("clock change during a slow save cannot display an approval for the old proposal", async ({
  page,
}) => {
  let release: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/approvals", async (route) => {
    await hold;
    await route.fulfill({
      status: 503,
      json: { detail: "Canceled test request" },
    });
  });
  await review(page).getByRole("checkbox").check();
  await review(page)
    .getByRole("button", { name: "Approve revised plan" })
    .click();
  await expect(review(page).getByText("Saving local approval…")).toBeVisible();
  await page.getByLabel("Evidence clock").selectOption("expired");
  release();
  await expect(
    review(page).getByRole("heading", {
      name: "All work is held. Get fresh evidence first.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Approved teammate updates")).toHaveCount(0);
});

test("mobile approval and expanded briefs have no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await approve(page);
  await expect(
    page.getByRole("article", { name: "Field lead update" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await review(page).screenshot({
    path: "docs/images/approved-plan-mobile.png",
  });
});

test("clipboard denial gives a selectable-text and download fallback", async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("Denied")) },
    });
  });
  await approve(page);
  await page
    .getByRole("button", { name: "Copy update for field lead" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Clipboard unavailable/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download shift brief" }),
  ).toBeEnabled();
});
