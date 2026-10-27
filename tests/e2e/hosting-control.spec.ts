import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { controlPage } from "../../apps/controller/src/page";

const status = (phase = "off", owner = true) => ({
  phase,
  owner,
  activeEndAt: null as number | null,
  costStopAt: null as number | null,
  accountingHold: false,
  startupEnabled: false,
  dailyAvailable: 1.35,
  lifetimeAvailable: 9.85,
});

test("owner sees honest setup and shared budget; polling never opens a run", async ({
  page,
}, info) => {
  const methods: string[] = [];
  const html = controlPage();
  await page.route("**/demo", async (route) =>
    route.fulfill({
      status: 200,
      headers: Object.fromEntries(html.headers),
      body: await html.clone().text(),
    }),
  );
  await page.route("**/api/**", (route) => {
    methods.push(route.request().method());
    return route.fulfill({ json: status() });
  });
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Start the live demo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start live demo", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Setup is being finished.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("$5.00 per Los Angeles", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Available for a new run:", { exact: false }),
  ).toContainText("$1.35 today");
  await expect(
    page.getByRole("button", { name: "Open shift workspace" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "End shared session" }),
  ).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("control-mobile.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("link", { name: "Owner controls", exact: true }),
  ).toHaveAttribute("href", "/owner");
  expect(methods.every((method) => method === "GET")).toBe(true);
});

for (const [phase, heading] of [
  ["reserved", "Starting the demo"],
  ["ready", "Demo is ready"],
  ["active", "Demo is running"],
  ["stopping", "Ending the session"],
  ["terminated", "Preparing the next session"],
])
  test(`guest sees ${phase} state and never owner controls`, async ({
    page,
  }) => {
    const html = controlPage();
    await page.route("**/demo", async (route) =>
      route.fulfill({
        status: 200,
        headers: Object.fromEntries(html.headers),
        body: await html.clone().text(),
      }),
    );
    await page.route("**/api/status", (route) =>
      route.fulfill({ json: status(phase, false) }),
    );
    await page.goto("/demo");
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start live demo", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "End shared session" }),
    ).toBeHidden();
    const open = page.getByRole("button", { name: "Open shift workspace" });
    if (["ready", "active"].includes(phase)) await expect(open).toBeEnabled();
    else await expect(open).toBeHidden();
  });

test("open is explicit, duplicate clicks submit once, and failed join stays on the control page", async ({
  page,
}) => {
  const html = controlPage();
  let opens = 0;
  await page.route("**/demo", async (route) =>
    route.fulfill({
      status: 200,
      headers: Object.fromEntries(html.headers),
      body: await html.clone().text(),
    }),
  );
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: status("ready", false) }),
  );
  await page.route("**/api/open", async (route) => {
    opens++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 409, json: { accepted: false } });
  });
  await page.goto("/demo");
  const button = page.getByRole("button", { name: "Open shift workspace" });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("could not finish");
  expect(opens).toBe(1);
  expect(new URL(page.url()).pathname).toBe("/demo");
});

test("accepted join navigates to workspace and status errors offer recovery", async ({
  page,
}) => {
  const html = controlPage();
  let failed = true;
  await page.route("**/demo", async (route) =>
    route.fulfill({
      status: 200,
      headers: Object.fromEntries(html.headers),
      body: await html.clone().text(),
    }),
  );
  await page.route("**/api/status", (route) =>
    failed
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: status("ready", false) }),
  );
  await page.route("**/api/open", (route) =>
    route.fulfill({ json: { accepted: true } }),
  );
  await page.route("**/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Workspace test fixture</h1>",
    }),
  );
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Session status unavailable" }),
  ).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("button", { name: "Open shift workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace test fixture" }),
  ).toBeVisible();
});

test("accounting hold blocks opening and owner shutdown remains visibly unconfirmed", async ({
  page,
}) => {
  const html = controlPage();
  let state = { ...status("active"), accountingHold: true };
  await page.route("**/demo", async (route) =>
    route.fulfill({
      status: 200,
      headers: Object.fromEntries(html.headers),
      body: await html.clone().text(),
    }),
  );
  await page.route("**/api/status", (route) => route.fulfill({ json: state }));
  await page.route("**/api/stop", (route) => {
    state = { ...state, phase: "stopping", accountingHold: false };
    return route.fulfill({ status: 202, json: { shutdownConfirmed: false } });
  });
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Demo is paused" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open shift workspace" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "End shared session" }).click();
  await expect(
    page.getByRole("heading", { name: "Ending the session" }),
  ).toBeVisible();
  await expect(
    page.getByText("New work is paused", { exact: false }),
  ).toBeVisible();
});

test("an unknown reviewer can start once and join without owner approval", async ({
  page,
}) => {
  const html = controlPage();
  let phase = "off",
    starts = 0;
  await page.route("**/demo", async (route) =>
    route.fulfill({
      headers: Object.fromEntries(html.headers),
      body: await html.clone().text(),
    }),
  );
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: { ...status(phase, false), startupEnabled: true, idleEndAt: null },
    }),
  );
  await page.route("**/api/start", async (route) => {
    starts++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    phase = "ready";
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/demo");
  const start = page.getByRole("button", {
    name: "Start live demo",
    exact: true,
  });
  await expect(start).toBeEnabled();
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(start).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Open shift workspace" }),
  ).toBeEnabled();
  expect(starts).toBe(1);
  await expect(
    page.getByRole("button", { name: "End shared session" }),
  ).toBeHidden();
  await expect(page.getByText(/thirty idle minutes/)).toBeVisible();
});

test("idle warning needs an explicit keep-working action; a budget deadline cannot be extended", async ({
  page,
}) => {
  let state = {
    ...status("active", false),
    idleEndAt: Date.now() + 120000,
    costStopAt: Date.now() + 3600000,
    activeEndAt: Date.now() + 3600000,
  };
  let activity = 0;
  await page.route("**/api/status", (route) => route.fulfill({ json: state }));
  await page.route("**/api/activity", (route) => {
    activity++;
    return route.fulfill({ json: { accepted: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Keep working", exact: true }),
  ).toBeVisible();
  expect(activity).toBe(0);
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Keep working", exact: true }),
  ).toBeHidden();
  expect(activity).toBe(1);
  state = {
    ...state,
    idleEndAt: Date.now() + 3600000,
    costStopAt: Date.now() + 120000,
  };
  await page.reload();
  await expect(
    page.getByText("This session is nearing its shared time or budget limit."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep working", exact: true }),
  ).toBeHidden();
  expect(activity).toBe(1);
});

test("startup shows real stages, elapsed time and a skeleton, then reveals explicit open", async ({
  page,
}, info) => {
  await page.clock.install();
  let phase = "reserved",
    stage = "allocating",
    polls = 0;
  let detail: { stage: string; changedAt: number; checkedAt: number } | null =
    null;
  const html = controlPage();
  await page.route("**/demo", async (route) =>
    route.fulfill({
      headers: Object.fromEntries(html.headers),
      body: await html.clone().text(),
    }),
  );
  await page.route("**/api/status", (route) => {
    polls++;
    return route.fulfill({
      json: {
        ...status(phase, false),
        startup: { stage, elapsedMs: 65000, detail },
      },
    });
  });
  await page.goto("/demo");
  const progress = page.getByRole("region", {
    name: "Getting your workspace ready",
  });
  await expect(progress).toBeVisible();
  await expect(
    page.getByText("Waiting for allocation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Total startup 1m 05s", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-skeleton")).toBeVisible();
  expect(
    await page
      .locator(".skeleton-line")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  stage = "preparing";
  await page.clock.runFor(5000);
  await expect(page.getByText("Allocated", { exact: true })).toBeVisible();
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Downloading or starting the GPU environment.", {
      exact: false,
    }),
  ).toBeVisible();
  detail = {
    stage: "loading_model",
    changedAt: Date.now(),
    checkedAt: Date.now(),
  };
  await page.clock.runFor(5000);
  await expect(
    page.getByText("Load the packaged model.", { exact: false }),
  ).toBeVisible();
  detail = {
    stage: "checking_workspace",
    changedAt: Date.now(),
    checkedAt: Date.now(),
  };
  await page.clock.runFor(5000);
  await expect(
    page.getByText("The model is loaded.", { exact: false }),
  ).toBeVisible();
  expect(polls).toBeGreaterThan(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("startup-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("startup-mobile.png"),
    fullPage: true,
  });
  phase = "ready";
  await page.clock.runFor(5000);
  await expect(progress).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open shift workspace" }),
  ).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe("/demo");
});

test("failed startup checks hide stale progress and recover without a second start", async ({
  page,
}) => {
  let failed = false,
    checks = 0;
  const html = controlPage();
  await page.route("**/demo", async (route) =>
    route.fulfill({
      headers: Object.fromEntries(html.headers),
      body: await html.clone().text(),
    }),
  );
  await page.route("**/api/status", (route) => {
    checks++;
    return failed
      ? route.fulfill({ status: 503 })
      : route.fulfill({
          json: {
            ...status("reserved", false),
            startup: { stage: "confirming", elapsedMs: 120000 },
          },
        });
  });
  await page.goto("/demo");
  await expect(
    page.getByText("Confirming request", { exact: true }),
  ).toBeVisible();
  failed = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Session status unavailable" }),
  ).toBeVisible();
  await expect(page.locator("#startup")).toBeHidden();
  failed = false;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(
    page.getByText("Confirming request", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start live demo", exact: true }),
  ).toBeHidden();
  expect(checks).toBe(3);
});
