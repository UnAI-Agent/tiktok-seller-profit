import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../support/fixtures";
import { email, makePro, seedToken, wipeExtension } from "../support/session";

const snapshots = path.join(path.dirname(fileURLToPath(import.meta.url)), "12-visual-a11y.spec.ts-snapshots");
const BASELINES = ["logged-out", "collapsed", "logged-in", "plans", "board"];

test("E-VIS-SNAPSHOTS screenshot baselines of the main panels", async ({ page, harness, context, extId, overlay }) => {
  // Baselines are per OS. Where this OS has none yet (a fresh CI runner), skip rather than
  // fail; `npm run test:baselines` sets E2E_VISUAL_BASELINES=1 and writes them for review.
  const have = BASELINES.every((name) => existsSync(path.join(snapshots, `${name}-${process.platform}.png`)));
  test.skip(
    !have && process.env.E2E_VISUAL_BASELINES !== "1",
    `skip:no ${process.platform} screenshot baselines yet. Run npm run test:baselines (E2E_VISUAL_BASELINES=1), review the PNGs, commit them.`,
  );
  await wipeExtension(context, extId, page);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page).getByText("$36.00")).toBeVisible();
  await expect(overlay(page)).toHaveScreenshot("logged-out.png");
  await overlay(page).getByRole("button", { name: "Minimize" }).click();
  await expect(overlay(page).getByRole("button", { name: "Open MarginMark" })).toBeVisible();
  // The minimized tab sits on the right edge, centred. Wait for that placement, and keep this
  // tab in front: a background tab gets no animation frames, so the screenshot never settles.
  await expect.poll(() => overlay(page).evaluate((el) => (el as HTMLElement).style.transform)).toBe("translateY(-50%)");
  await page.bringToFront();
  await expect(overlay(page)).toHaveScreenshot("collapsed.png");
  await overlay(page).getByRole("button", { name: "Open MarginMark" }).click();
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token, page);
  await page.reload();
  await expect(overlay(page).getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(overlay(page)).toHaveScreenshot("logged-in.png");
  await overlay(page).getByRole("button", { name: "Upgrade" }).click();
  await expect(overlay(page).getByText("Start")).toBeVisible();
  await expect(overlay(page)).toHaveScreenshot("plans.png");
  await makePro(harness.api, user.userId);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = overlay(page);
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: "Sync" }).click();
  await panel.getByRole("button", { name: "Overview" }).click();
  await expect(panel.getByText("Who is losing money")).toBeVisible();
  await expect(panel).toHaveScreenshot("board.png");
});

test("E-A11Y-AXE the open panel has no critical or serious violations", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page).getByText("$36.00")).toBeVisible();
  const results = await new AxeBuilder({ page }).include("#tiktok-seller-tool-root").analyze();
  const bad = results.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
  expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
});
