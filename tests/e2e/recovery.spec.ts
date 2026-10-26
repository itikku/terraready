import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const shift = (page: Page) =>
  page.getByRole("region", { name: "Choose this shift's work" });
const choice = (page: Page, name: string) =>
  shift(page).getByLabel(`Decision for ${name}`, { exact: true });
const review = (page: Page, count: number) =>
  shift(page).getByRole("button", {
    name: `Review ${count} assignment${count === 1 ? "" : "s"}`,
    exact: true,
  });
async function ready(page: Page) {
  await expect(review(page, 4)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  execFileSync(".venv/bin/python", ["scripts/reset_browser_approvals.py"]);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
  await page.goto("/#recovery-heading");
  await ready(page);
});

test("work choices retain real per-package decisions and protected holds", async ({
  page,
}) => {
  const button = await review(page, 4).boundingBox();
  expect(button!.y + button!.height).toBeLessThan(1100);
  await expect(shift(page).getByRole("combobox")).toHaveCount(6);
  await expect(choice(page, "Inspect west stockpile ground")).toBeDisabled();
  await expect(choice(page, "Verify west-stockpile layout")).toBeDisabled();
  await expect(
    shift(page).getByText(
      /Requires actual completion: Inspect west stockpile ground/,
    ),
  ).toBeVisible();
  await expect(
    choice(page, "Haul material from east cut").getByRole("option", {
      name: /North access/,
    }),
  ).toHaveCount(0);
  await expect(
    shift(page).getByText("7 packages · 1 already completed"),
  ).toBeVisible();
  await shift(page).screenshot({ path: "docs/images/shift-decisions.png" });
  await shift(page)
    .getByRole("button", {
      name: "Inspect evidence for Haul material from east cut",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Zone evidence").getByRole("heading", { name: "East cut" }),
  ).toBeFocused();
});

test("operator defers a package, changes a route and approves only that checked selection", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await choice(page, "Clear service-yard drainage trench").selectOption("");
  const excavation = choice(page, "Prepare east cut");
  const south = await excavation
    .getByRole("option", { name: /EX-01.*South access/ })
    .getAttribute("value");
  await excavation.selectOption(south!);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/recovery/evaluate") && r.ok(),
  );
  await review(page, 3).click();
  const checked = await (await response).json();
  await expect(
    shift(page).getByRole("heading", { name: "Review your 3 assignments" }),
  ).toBeFocused();
  expect(checked.selected_candidate_ids).toHaveLength(3);
  expect(checked.selected_candidate_ids).toContain(south);
  await expect(
    shift(page).getByText("Clear service-yard drainage trench · deferred", {
      exact: true,
    }),
  ).toBeVisible();
  const approve = shift(page).getByRole("button", {
    name: "Approve these 3 assignments",
    exact: true,
  });
  await expect(approve).toBeDisabled();
  await shift(page).getByRole("checkbox").check();
  const saving = page.waitForRequest((r) =>
    r.url().endsWith("/recovery/approvals"),
  );
  await approve.click();
  expect((await saving).postDataJSON().candidate_ids).toEqual(
    checked.selected_candidate_ids,
  );
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
  await expect(
    shift(page).getByRole("heading", {
      name: "Response approved. Prepare the team briefs.",
      exact: true,
    }),
  ).toBeFocused();
  await shift(page)
    .getByRole("button", { name: "Copy haul coordinator brief", exact: true })
    .click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("HOLD Clear service-yard drainage trench");
  expect(copied).toContain("South access");
  expect(copied).toContain("Nothing sent or dispatched");
  await page.reload();
  await expect(
    shift(page).getByRole("heading", { name: "Review your 3 assignments" }),
  ).toBeVisible();
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
});

test("editing a checked selection clears confirmation and never reuses another response's briefs", async ({
  page,
}) => {
  await review(page, 4).click();
  await shift(page).getByRole("checkbox").check();
  await shift(page)
    .getByRole("button", { name: "Change package decisions" })
    .click();
  await choice(page, "Inspect service-yard drainage outlets").selectOption("");
  await review(page, 3).click();
  await expect(shift(page).getByRole("checkbox")).not.toBeChecked();
  await expect(
    shift(page).getByRole("button", { name: "Approve these 3 assignments" }),
  ).toBeDisabled();
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toHaveCount(0);
});

test("server rejects an invalid combination without discarding the operator's choices", async ({
  page,
}) => {
  await choice(page, "Clear service-yard drainage trench").selectOption("");
  await page.route("**/recovery/evaluate", (route) =>
    route.fulfill({
      status: 422,
      json: { detail: "Selected work exceeds capacity" },
    }),
  );
  await review(page, 3).click();
  await expect(shift(page).getByRole("alert")).toContainText(
    "exceed a resource limit",
  );
  await expect(choice(page, "Clear service-yard drainage trench")).toHaveValue(
    "",
  );
  await expect(shift(page).getByRole("checkbox")).toHaveCount(0);
  await page.unroute("**/recovery/evaluate");
  await review(page, 3).click();
  await expect(
    shift(page).getByRole("heading", { name: "Review your 3 assignments" }),
  ).toBeVisible();
});

test("late results cannot replace a newer package decision", async ({
  page,
}) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const oldDone = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let delayed = false;
  await page.route("**/recovery/evaluate", async (route) => {
    const response = await route.fetch();
    if (route.request().postDataJSON().candidate_ids.length === 3 && !delayed) {
      delayed = true;
      await wait;
      await route.fulfill({ response }).catch(() => {});
      finished();
    } else await route.fulfill({ response });
  });
  await choice(page, "Clear service-yard drainage trench").selectOption("");
  await review(page, 3).click();
  await expect(
    shift(page).getByRole("button", { name: "Checking choices…" }),
  ).toBeVisible();
  await choice(page, "Inspect service-yard drainage outlets").selectOption("");
  await review(page, 2).click();
  await expect(
    shift(page).getByRole("heading", { name: "Review your 2 assignments" }),
  ).toBeVisible();
  release();
  await oldDone;
  await expect(
    shift(page).getByRole("heading", { name: "Review your 2 assignments" }),
  ).toBeVisible();
});

test("empty and expired work cannot be approved; a pending save cannot cross the evidence clock", async ({
  page,
}) => {
  for (const name of [
    "Prepare east cut",
    "Haul material from east cut",
    "Clear service-yard drainage trench",
    "Inspect service-yard drainage outlets",
  ])
    await choice(page, name).selectOption("");
  await expect(
    shift(page).getByRole("button", { name: "Review 0 assignments" }),
  ).toBeDisabled();
  await expect(shift(page).getByText(/No work selected/)).toBeVisible();
  await page.reload();
  await ready(page);
  await review(page, 4).click();
  await shift(page).getByRole("checkbox").check();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let writes = 0;
  await page.route("**/recovery/approvals", async (route) => {
    writes += 1;
    const response = await route.fetch();
    await wait;
    await route.fulfill({ response }).catch(() => {});
    finished();
  });
  await shift(page)
    .getByRole("button", { name: "Approve these 4 assignments" })
    .dblclick();
  await expect(
    shift(page).getByRole("button", { name: "Saving response…" }),
  ).toBeDisabled();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByLabel("Evidence clock").selectOption("expired");
  await expect(
    shift(page).getByRole("button", { name: "Review 0 assignments" }),
  ).toBeDisabled();
  release();
  await done;
  expect(writes).toBe(1);
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toHaveCount(0);
  await expect(choice(page, "Haul material from east cut")).toBeDisabled();
});

test("failed or mismatched approval requires fresh review and shows no success", async ({
  page,
}) => {
  await review(page, 4).click();
  await shift(page).getByRole("checkbox").check();
  await page.route("**/recovery/approvals", (route) =>
    route.fulfill({ status: 409, json: { detail: "Snapshot changed" } }),
  );
  await shift(page)
    .getByRole("button", { name: "Approve these 4 assignments" })
    .click();
  await expect(shift(page).getByRole("alert")).toContainText(
    "proposal changed",
  );
  await expect(shift(page).getByRole("checkbox")).toHaveCount(0);
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toHaveCount(0);
  await page.unroute("**/recovery/approvals");
  await review(page, 4).click();
  await shift(page).getByRole("checkbox").check();
  await page.route("**/recovery/approvals", (route) =>
    route.fulfill({ json: { plan_id: "different-selection", updates: [] } }),
  );
  await shift(page)
    .getByRole("button", { name: "Approve these 4 assignments" })
    .click();
  await expect(shift(page).getByRole("alert")).toContainText(
    "does not match these choices",
  );
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toHaveCount(0);
});

test("shift loading and retry are independent of the evidence workspace", async ({
  page,
}) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/recovery", async (route) => {
    await wait;
    await route.fulfill({ status: 503, json: { detail: "Unavailable" } });
  });
  await page.reload();
  await expect(shift(page).getByRole("status")).toHaveText(
    "Checking this shift…",
  );
  await page.getByRole("link", { name: "Site evidence", exact: true }).click();
  await expect(
    page.getByLabel("Site workspace", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to shift choices" }).click();
  release();
  await expect(shift(page).getByRole("alert")).toBeVisible();
  await page.unroute("**/recovery");
  await shift(page).getByRole("button", { name: "Retry shift" }).click();
  await ready(page);
});

test("mobile, keyboard, evidence navigation and zoom-equivalent reflow remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await review(page, 4).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await review(page, 4).focus();
  await page.keyboard.press("Enter");
  await expect(
    shift(page).getByRole("heading", { name: "Review your 4 assignments" }),
  ).toBeFocused();
  await shift(page).screenshot({ path: "docs/images/shift-review-mobile.png" });
  await shift(page).getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await shift(page)
    .getByRole("button", { name: "Approve these 4 assignments" })
    .click();
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shift(page).screenshot({
    path: "docs/images/shift-approved-mobile.png",
  });
  // 1512 display pixels at 200% zoom correspond to 756 CSS pixels of reflow.
  await page.setViewportSize({ width: 756, height: 550 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(756);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("browser storage and clipboard denial preserve checking, approval and readable briefs", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  await page.reload();
  await ready(page);
  await review(page, 4).click();
  await expect(shift(page).getByRole("status")).toContainText(
    "could not keep your choices",
  );
  await shift(page).getByRole("checkbox").check();
  await shift(page)
    .getByRole("button", { name: "Approve these 4 assignments" })
    .click();
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Denied");
        },
      },
      configurable: true,
    }),
  );
  await shift(page)
    .getByRole("button", { name: "Copy field lead brief", exact: true })
    .click();
  await expect(shift(page).getByRole("status")).toContainText(
    "Clipboard unavailable",
  );
  await expect(
    shift(page)
      .getByLabel("Approved shift recovery briefs")
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: "Field lead", exact: true }),
      })
      .getByText(/HOLD Inspect west stockpile ground/),
  ).toBeVisible();
});

test("loading an existing approval never steals focus from an evidence decision", async ({
  page,
}) => {
  await review(page, 4).click();
  await shift(page).getByRole("checkbox").check();
  await shift(page)
    .getByRole("button", { name: "Approve these 4 assignments" })
    .click();
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/recovery", async (route) => {
    const response = await route.fetch();
    await wait;
    await route.fulfill({ response });
  });
  await page.reload();
  await page.getByRole("link", { name: "Site evidence", exact: true }).click();
  const east = page.getByRole("button", {
    name: "Inspect East cut",
    exact: true,
  });
  await east.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Zone evidence").getByRole("heading", { name: "East cut" }),
  ).toBeVisible();
  release();
  await expect(page.getByLabel("Approved shift recovery briefs")).toHaveCount(
    1,
  );
  await expect(east).toBeFocused();
  await page.getByRole("link", { name: "Back to shift choices" }).click();
  await expect(
    shift(page).getByLabel("Approved shift recovery briefs"),
  ).toBeVisible();
});
