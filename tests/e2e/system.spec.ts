import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { SystemEvidence } from "../../apps/web/src/types";

async function systemResponse(
  page: Page,
  update: (body: SystemEvidence) => void,
) {
  await page.route("**/api/system", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    update(body);
    await route.fulfill({ response, json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
});

test("workspace links to the system and native back navigation returns to the site", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "System & deployment", exact: true })
    .click();
  await expect(page).toHaveURL(/\/system$/);
  await expect(
    page.getByRole("heading", { name: /Local intelligence/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Protocol stub reachable", { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Good ground. Better decisions." }),
  ).toBeVisible();
});

test("deep link shows actual recorded cases, provenance and explicit limits", async ({
  page,
  request,
}) => {
  const body = await (await request.get("/api/system")).json();
  await page.goto("/system");
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toBeVisible();
  await expect(page.getByText(/TEST STUB — no real inference/)).toBeVisible();
  for (const c of body.verification.evidence.cases) {
    await expect(
      page.getByRole("heading", {
        name: `Passed · ${(c.elapsed_ms / 1000).toFixed(1)}s`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page
    .getByText("Exact model, source and measurement provenance", {
      exact: true,
    })
    .click();
  await expect(
    page
      .locator(".system-provenance")
      .first()
      .getByText(body.verification.evidence.model.weights_sha256, {
        exact: true,
      }),
  ).toBeVisible();
  await expect(
    page.getByText(/Working tree had changes|Clean working tree at capture/),
  ).toBeVisible();
  await expect(
    page.getByText("Jetson: not deployed and not planned for this POC.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Power and production reliability.", { exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/images/system-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toBeVisible();
});

test("unavailable current runtime never erases or upgrades historical evidence", async ({
  page,
}) => {
  await systemResponse(page, (body) => {
    body.runtime.reachable = false;
    body.runtime.mode = "local_model";
    body.data_ready = false;
  });
  await page.goto("/system");
  await expect(
    page.getByRole("heading", { name: "Local runtime unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Local data unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toBeVisible();
  await expect(page.getByText(/no cloud fallback/).first()).toBeVisible();
});

for (const status of ["missing", "invalid"] as const) {
  test(`${status} verification is not replaced with sample metrics`, async ({
    page,
  }) => {
    await systemResponse(page, (body) => {
      body.verification = { status, evidence: null };
      body.gpu_verification = { status, evidence: null };
    });
    await page.goto("/system");
    await expect(
      page.getByRole("heading", {
        name: `Verification artifact ${status} · not measured here`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "3 of 3 task checks passed" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Not measured here", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/No sample timings or green validation badges/),
    ).toBeVisible();
  });
}

test("system API failure is retryable while the architecture remains readable", async ({
  page,
}) => {
  await page.route("**/api/system", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
  await page.goto("/system");
  await expect(page.getByRole("alert")).toContainText(
    "System status could not be checked",
  );
  await expect(
    page.getByRole("heading", { name: "What the model cannot decide." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verification evidence not loaded" }),
  ).toBeVisible();
  await page.unroute("**/api/system");
  await page.getByRole("button", { name: "Refresh local status" }).click();
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toBeVisible();
});

test("loading never implies runtime or hardware validation", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/system", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/system");
  await expect(page.getByRole("status")).toContainText("Checking local data");
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toBeVisible();
});

test("runtime reachability is not presented as successful inference", async ({
  page,
}) => {
  await systemResponse(page, (body) => {
    body.runtime.reachable = true;
    body.runtime.mode = "local_model";
  });
  await page.goto("/system");
  await expect(
    page.getByRole("heading", { name: "Local runtime reachable" }),
  ).toBeVisible();
  await expect(
    page.getByText(/No inference was run by this page/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Not measured yet" }),
  ).toBeVisible();
});

test("mobile provenance, keyboard skip and navigation stay accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/system");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to system details" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#system-main")).toBeFocused();
  await page
    .getByText("Exact model, source and measurement provenance", {
      exact: true,
    })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/images/system-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good ground. Better decisions." }),
  ).toBeVisible();
});

test("recorded GPU measurements stay separate from live reachability and pending cost", async ({
  page,
  request,
}) => {
  const body = await (await request.get("/api/system")).json();
  const gpu = body.gpu_verification.evidence.gpu_test;
  await systemResponse(page, (response) => {
    response.runtime.reachable = false;
    response.runtime.mode = "local_model";
    response.gpu_verification!.evidence!.gpu_test!.billing_status = "pending";
    response.gpu_verification!.evidence!.gpu_test!.provider_charge_usd = null;
  });
  await page.goto("/system");
  const recorded = page.getByLabel("Recorded private GPU verification");
  await expect(
    page.getByRole("heading", { name: "Local runtime unavailable" }),
  ).toBeVisible();
  await expect(
    recorded.getByRole("heading", { name: "1 × NVIDIA L4" }),
  ).toBeVisible();
  await expect(
    recorded.getByRole("heading", {
      name: `p50 ${(gpu.warm_p50_ms / 1000).toFixed(2)}s · p95 ${(gpu.warm_p95_ms / 1000).toFixed(2)}s`,
    }),
  ).toBeVisible();
  await expect(
    recorded.getByText(
      "Final provider charge pending reconciliation; no zero-cost claim. Usage ceiling: $5.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    recorded.getByText(/Observed account balance decrease: \$0.16/),
  ).toBeVisible();
  await expect(recorded.getByText(/Provider-recorded charge/)).toHaveCount(0);
  await expect(
    recorded.getByText("Temporary Pod terminated · cleanup verified", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toBeVisible();
  await recorded
    .getByText("GPU source, allocation and cleanup provenance", { exact: true })
    .click();
  await expect(
    recorded.getByText(gpu.container_image_sha256, { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/images/gpu-system-mobile.png",
    fullPage: true,
  });
});

test("provider-recorded cost is displayed only when billing is reconciled", async ({
  page,
}) => {
  await systemResponse(page, (body) => {
    const gpu = body.gpu_verification!.evidence!.gpu_test!;
    gpu.billing_status = "recorded";
    gpu.provider_charge_usd = 0.125;
  });
  await page.goto("/system");
  await expect(
    page.getByText("Provider-recorded charge: $0.1250. Usage ceiling: $5.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Final provider charge pending reconciliation; no zero-cost claim. Usage ceiling: $5.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("invalid GPU artifact cannot borrow the native smoke's measurements", async ({
  page,
}) => {
  await systemResponse(page, (body) => {
    body.gpu_verification = { status: "invalid", evidence: null };
  });
  await page.goto("/system");
  await expect(
    page.getByRole("heading", {
      name: "GPU artifact invalid · not measured here",
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Recorded private GPU verification"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "3 of 3 task checks passed" }),
  ).toBeVisible();
});
