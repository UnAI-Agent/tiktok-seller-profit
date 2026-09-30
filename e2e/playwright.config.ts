import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testIgnore: ["**/support/**"],
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "../qa/report/playwright-results.json" }],
    ["html", { outputFolder: "../qa/report/e2e", open: "never" }],
  ],
});
