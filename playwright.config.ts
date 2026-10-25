import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(".data/pw-browsers");
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:5174",
    ...devices["Desktop Chrome"],
    channel: "chromium",
    viewport: { width: 1512, height: 1100 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    reducedMotion: "reduce",
  },
  webServer: [
    {
      command:
        ".venv/bin/uvicorn scripts.browser_api:stub --host 127.0.0.1 --port 8082",
      url: "http://127.0.0.1:8082/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command:
        "make seed && .venv/bin/uvicorn scripts.browser_api:app --host 127.0.0.1 --port 8001",
      env: { TERRAREADY_DB_DIR: ".data/e2e-lancedb" },
      url: "http://127.0.0.1:8001/ready",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "npx vite apps/web --host 127.0.0.1 --port 5174 --strictPort",
      env: { VITE_MAPBOX_TOKEN: "test-token", TERRAREADY_BROWSER_TEST: "1" },
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
