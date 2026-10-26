import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const endpoint = "**/zones/*/camera";
const source = (page: import("@playwright/test").Page) =>
  page.getByRole("group", { name: "Camera source" });
async function supplied() {
  return {
    mode: "external_snapshot",
    status: "available",
    snapshot: {
      camera_id: "test-camera",
      snapshot_id: "test-frame",
      captured_at: "2026-10-25T15:00:00Z",
      media_type: "image/png",
      sha256: "a".repeat(64),
      image_base64: (
        await readFile("apps/web/public/imagery/north-inspection.png")
      ).toString("base64"),
    },
  };
}
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  );
});

test("default image explicitly says disconnected demo stub", async ({
  page,
}) => {
  await page.goto("/#ground-evidence");
  await expect(
    source(page).getByText(/Demo camera stub · no camera connected/),
  ).toBeVisible();
  await expect(
    page.getByText("Current demo evidence", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Synthetic illustration/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enlarge synthetic inspection image" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Synthetic inspection image" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByLabel("Zone evidence")
    .screenshot({ path: "docs/images/camera-stub.png" });
});

test("supplied snapshot shows capture provenance without changing measurements", async ({
  page,
}) => {
  const capture = await supplied();
  await page.route(endpoint, (route) => route.fulfill({ json: capture }));
  await page.goto("/#ground-evidence");
  await expect(
    source(page).getByText(/External snapshot · test-camera/),
  ).toBeVisible();
  await expect(
    page.getByText("CAMERA SNAPSHOT · NOT LIVE VIDEO", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("72%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enlarge camera snapshot" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Camera snapshot" })
      .getByText(/capture test-frame/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByLabel("Zone evidence")
    .screenshot({ path: "docs/images/camera-adapter-mobile.png" });
});

test("unavailable snapshot retries without pretending the fixture is a camera capture", async ({
  page,
}) => {
  let ready = false;
  const capture = await supplied();
  await page.route(endpoint, (route) =>
    route.fulfill({
      json: ready
        ? capture
        : { mode: "external_snapshot", status: "unavailable", snapshot: null },
    }),
  );
  await page.goto("/#ground-evidence");
  await expect(
    source(page).getByText(/Camera snapshot unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Historical aerial context/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Synthetic illustration/ }),
  ).toHaveCount(0);
  ready = true;
  await source(page)
    .getByRole("button", { name: "Refresh camera snapshot" })
    .click();
  await expect(
    page.getByRole("img", { name: "Camera snapshot from test-camera" }),
  ).toBeVisible();
});

test("HTTP failure and corrupt image stay explicitly unavailable", async ({
  page,
}) => {
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/#ground-evidence");
  await expect(
    source(page).getByText(/Camera snapshot unavailable/),
  ).toBeVisible();
  const capture = await supplied();
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { ...capture, snapshot: null } }),
  );
  await source(page)
    .getByRole("button", { name: "Refresh camera snapshot" })
    .click();
  await expect(
    source(page).getByText(/Camera snapshot unavailable/),
  ).toBeVisible();
  capture.snapshot.image_base64 = "eA==";
  await page.route(endpoint, (route) => route.fulfill({ json: capture }));
  await source(page)
    .getByRole("button", { name: "Refresh camera snapshot" })
    .click();
  await expect(
    source(page).getByText(/Camera snapshot unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Historical aerial context/ }),
  ).toBeVisible();
});

test("slow old-zone response cannot replace the selected zone source", async ({
  page,
}) => {
  const capture = await supplied();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/zones/north-access/camera", async (route) => {
    await gate;
    await route.fulfill({ json: capture }).catch(() => {});
  });
  await page.route("**/zones/west-stockpile/camera", (route) =>
    route.fulfill({
      json: {
        mode: "external_snapshot",
        status: "unavailable",
        snapshot: null,
      },
    }),
  );
  await page.goto("/#ground-evidence");
  await expect(
    source(page).getByText("Checking camera source…", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect West stockpile", exact: true })
    .click();
  await expect(
    source(page).getByText(/Camera snapshot unavailable/),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("img", { name: "Camera snapshot from test-camera" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByLabel("Zone evidence")
      .getByRole("heading", { name: "West stockpile" }),
  ).toBeVisible();
});
