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
  // Fonts and anti-aliasing differ by OS, so each OS keeps its own baselines
  // (logged-out-win32.png, logged-out-linux.png, ...). Make them with: npm run test:baselines
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  use: {
    actionTimeout: 15_000,
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
