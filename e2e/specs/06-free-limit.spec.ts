import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../support/fixtures";
import { cancelLikeStripe, clickLeaving, email, makePro, seedToken, upgradeLikeStripe } from "../support/session";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tiers = JSON.parse(readFileSync(path.join(root, "src", "tiers.json"), "utf8")) as {
  free: { skuLimit: number };
  pro: { monthlyUsd: number; yearlyUsd: number; trialDays: number };
};

async function freeUser(
  api: import("../support/backend").Api,
  context: import("@playwright/test").BrowserContext,
  extId: string,
  keep?: import("@playwright/test").Page,
) {
  const user = await api.registerApi(email());
  await seedToken(context, extId, user.token, keep);
  return user;
}

test("E-LIMIT-6TH the sixth saved cost hits the free limit", async ({ page, harness, context, extId }) => {
  expect(tiers.free.skuLimit).toBe(5);
  await freeUser(harness.api, context, extId);
  const panel = page.locator("#tiktok-seller-tool-root");
  const products = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")).products.slice(0, 6);
  for (let i = 0; i < 5; i += 1) {
    await page.goto(`${harness.origin}/product/edit/${products[i].skuId}`);
    await panel.locator("#mm-hero-cost").fill("3");
    await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
    await expect(panel.getByText("Saved")).toBeVisible();
  }
  await page.goto(`${harness.origin}/product/edit/${products[5].skuId}`);
  await panel.locator("#mm-hero-cost").fill("3");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await expect(panel.getByText("You've used all your free product costs.")).toBeVisible();
});

test("E-LIMIT-UNLOCK unlock unlimited opens the plans view", async ({ page, harness, context, extId }) => {
  await freeUser(harness.api, context, extId);
  const panel = page.locator("#tiktok-seller-tool-root");
  const products = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")).products.slice(0, 6);
  for (let i = 0; i < 5; i += 1) {
    await page.goto(`${harness.origin}/product/edit/${products[i].skuId}`);
    await panel.locator("#mm-hero-cost").fill("3");
    await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
    await expect(panel.getByText("Saved")).toBeVisible();
  }
  await page.goto(`${harness.origin}/product/edit/${products[5].skuId}`);
  await panel.locator("#mm-hero-cost").fill("3");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await panel.getByRole("button", { name: "Unlock unlimited" }).click();
  await expect(panel.getByText(`$${tiers.pro.monthlyUsd}`)).toBeVisible();
});

test("E-LIMIT-AFTER-UPGRADE the sixth save succeeds after upgrading", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  const panel = page.locator("#tiktok-seller-tool-root");
  const products = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")).products.slice(0, 6);
  for (let i = 0; i < 5; i += 1) {
    await page.goto(`${harness.origin}/product/edit/${products[i].skuId}`);
    await panel.locator("#mm-hero-cost").fill("3");
    await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
    await expect(panel.getByText("Saved")).toBeVisible();
  }
  // Real purchase: webhook, then Stripe's success page. No reload of the seller tab.
  await upgradeLikeStripe(harness.api, context, user.userId);
  await page.goto(`${harness.origin}/product/edit/${products[5].skuId}`);
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  await panel.locator("#mm-hero-cost").fill("3");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await expect(panel.getByText("Saved")).toBeVisible();
  await expect(panel.getByText("You've used all your free product costs.")).toHaveCount(0);
});

test("E-BILL-PRICES plans show the prices and trial disclosure from tiers.json", async ({ page, harness, context, extId }) => {
  await freeUser(harness.api, context, extId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await expect(panel.getByText(`$${tiers.pro.monthlyUsd}`)).toBeVisible();
  await expect(panel.getByText(`$${tiers.pro.yearlyUsd}`).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: `Start ${tiers.pro.trialDays}-day free trial` })).toBeVisible();
  const disclosure = `$${tiers.pro.yearlyUsd}/year after a ${tiers.pro.trialDays}-day free trial. Renews automatically until you cancel. Cancel anytime in Manage billing.`;
  await expect(panel.getByText(disclosure).first()).toBeVisible();
});

test("E-BILL-UNVERIFIED an unverified user is sent to verify before checkout", async ({ page, harness, context, extId }) => {
  await freeUser(harness.api, context, extId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await panel.getByRole("button", { name: `Start ${tiers.pro.trialDays}-day free trial` }).click();
  await expect(panel.getByText("Verify your email to start your trial")).toBeVisible();
  await panel.getByRole("button", { name: "Open Account" }).click();
  await expect(panel.getByLabel("6-digit code")).toBeVisible();
});

test("E-BILL-503-UI checkout without Stripe shows the friendly message", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await harness.api.verifyEmail(user.userId, "");
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Account" }).click();
  await panel.getByRole("button", { name: "Back", exact: false }).click().catch(() => undefined);
  await page.reload();
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await panel.getByRole("button", { name: `Start ${tiers.pro.trialDays}-day free trial` }).click();
  await expect(panel.getByText("Billing is not configured. Nothing was charged.")).toBeVisible();
});

test("E-BILL-PRO-LIVE a real purchase unlocks Pro on the open overlay without a reload", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await harness.api.verifyEmail(user.userId, "");
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await expect(panel.getByText("Max commission & ad limits")).toBeVisible();
  // Webhook, then Stripe sends the seller to the success page in another tab.
  await upgradeLikeStripe(harness.api, context, user.userId);
  await page.bringToFront();
  await expect(panel.getByText("Pro unlocked. Every lock is open.")).toBeVisible();
  await expect(panel.getByText("Max commission & ad limits")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "+1 free sample sent" })).toBeVisible();
});

test("E-BILL-SAMPLE the free-sample button increments and persists", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await makePro(harness.api, user.userId);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await panel.getByRole("button", { name: "+1 free sample sent" }).click();
  await expect(panel.getByRole("button", { name: "+1 free sample sent (1)" })).toBeVisible();
  await page.reload();
  await expect(panel.getByRole("button", { name: "+1 free sample sent (1)" })).toBeVisible();
});

test("E-BILL-GRACE a failed invoice keeps Pro during the 3-day grace", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await upgradeLikeStripe(harness.api, context, user.userId);
  const failed = await harness.api.webhook("invoice.payment_failed", {
    id: "in_fail",
    object: "invoice",
    subscription: `sub_e2e_${user.userId}`,
  });
  expect(failed.ok).toBe(true);
  // The server must still say Pro, and a fresh panel must too.
  const me = await harness.api.me(user.token);
  expect(me.is_pro).toBe(true);
  const rows = (await harness.api.rows("subscriptions", `sub_e2e_${user.userId}`)) as { rows: Array<{ user_id: number; status: string }> };
  expect(rows.rows.find((row) => row.user_id === user.userId)?.status).toBe("past_due");
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Upgrade" })).toHaveCount(0);
});

test("E-BILL-CANCEL-LIVE a cancel returns the open overlay to Free", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await upgradeLikeStripe(harness.api, context, user.userId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  await cancelLikeStripe(harness.api, context, user.userId);
  await page.bringToFront();
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  expect((await harness.api.me(user.token)).is_pro).toBe(false);
});

test("E-BILL-LATE-INVOICE a late invoice.paid after a cancel does not restore Pro", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await upgradeLikeStripe(harness.api, context, user.userId);
  await cancelLikeStripe(harness.api, context, user.userId);
  const late = await harness.api.webhook("invoice.paid", {
    id: "in_late",
    object: "invoice",
    subscription: `sub_e2e_${user.userId}`,
  });
  expect(late.ok).toBe(true);
  // Server first, then a fresh panel after a forced plan check.
  expect((await harness.api.me(user.token)).is_pro).toBe(false);
  const done = await context.newPage();
  await done.goto("http://127.0.0.1:8000/billing/done?ok=1");
  await done.close();
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await expect(panel.getByText("PRO", { exact: true })).toHaveCount(0);
});

test("E-BILL-DONE-TAB only a successful checkout page refreshes the plan", async ({ page, harness, context, extId }) => {
  // ok=1: the backend already says Pro, the extension still has Free cached.
  const user = await freeUser(harness.api, context, extId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await makePro(harness.api, user.userId);
  const done = await context.newPage();
  await done.goto("http://127.0.0.1:8000/billing/done?ok=1");
  await page.bringToFront();
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  await done.close();

  // ok=0 (checkout canceled): same setup with a new account; the cached Free plan stays.
  const other = await freeUser(harness.api, context, extId, page);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await makePro(harness.api, other.userId);
  const canceled = await context.newPage();
  await canceled.goto("http://127.0.0.1:8000/billing/done?ok=0");
  await page.bringToFront();
  // Named wait: longer than the 2-second panel resync, so a wrong refresh would show.
  await page.waitForTimeout(5000);
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await canceled.close();
});

test("E-BILL-PROMO promo codes redeem once and reject bad or repeat codes", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Account" }).click();
  await panel.getByText("Have a promo code?").click();
  await panel.getByLabel("Promo code").fill("NOPE");
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByText("That code is not valid.")).toBeVisible();
  const code = `E2E${Date.now().toString().slice(-6)}`;
  const created = await fetch("http://127.0.0.1:8000/admin/promos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": harness.api.adminKey,
      "Fly-Client-IP": "203.0.113.60",
    },
    body: JSON.stringify({ code, service: "tiktok-seller-tool", duration_days: 30 }),
  });
  if (!created.ok) throw new Error(await created.text());
  await panel.getByLabel("Promo code").fill(code);
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByText(/Pro unlocked/)).toBeVisible();
  const me = await harness.api.me(user.token);
  expect(me.promo_expires_at).toBeTruthy();
  await panel.getByLabel("Promo code").fill(code);
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByText("You already used this code.")).toBeVisible();
});

test("E-BILL-DIAMOND-HIDDEN Diamond stays hidden while its flag is off", async ({ page, harness, context, extId }) => {
  await freeUser(harness.api, context, extId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await expect(panel.getByText("Diamond")).toHaveCount(0);
});
