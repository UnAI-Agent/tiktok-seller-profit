import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../support/fixtures";
import { email, makePro, seedToken } from "../support/session";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tiers = JSON.parse(readFileSync(path.join(root, "src", "tiers.json"), "utf8")) as {
  free: { skuLimit: number };
  pro: { monthlyUsd: number; yearlyUsd: number; trialDays: number };
};

async function freeUser(api: import("../support/backend").Api, context: import("@playwright/test").BrowserContext, extId: string) {
  const user = await api.registerApi(email());
  await seedToken(context, extId, user.token);
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
    await panel.getByRole("button", { name: "See my profit" }).click();
    await expect(panel.getByText("Saved")).toBeVisible();
  }
  await page.goto(`${harness.origin}/product/edit/${products[5].skuId}`);
  await panel.locator("#mm-hero-cost").fill("3");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(panel.getByText("You've used all your free product costs.")).toBeVisible();
});

test("E-LIMIT-UNLOCK unlock unlimited opens the plans view", async ({ page, harness, context, extId }) => {
  await freeUser(harness.api, context, extId);
  const panel = page.locator("#tiktok-seller-tool-root");
  const products = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")).products.slice(0, 6);
  for (let i = 0; i < 5; i += 1) {
    await page.goto(`${harness.origin}/product/edit/${products[i].skuId}`);
    await panel.locator("#mm-hero-cost").fill("3");
    await panel.getByRole("button", { name: "See my profit" }).click();
    await expect(panel.getByText("Saved")).toBeVisible();
  }
  await page.goto(`${harness.origin}/product/edit/${products[5].skuId}`);
  await panel.locator("#mm-hero-cost").fill("3");
  await panel.getByRole("button", { name: "See my profit" }).click();
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
    await panel.getByRole("button", { name: "See my profit" }).click();
    await expect(panel.getByText("Saved")).toBeVisible();
  }
  await makePro(harness.api, user.userId);
  await page.goto(`${harness.origin}/product/edit/${products[5].skuId}`);
  await panel.locator("#mm-hero-cost").fill("3");
  await panel.getByRole("button", { name: "See my profit" }).click();
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

test("E-BILL-PRO-LIVE a signed checkout unlocks Pro on the open overlay", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await harness.api.verifyEmail(user.userId, "");
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(panel.getByText("Max commission & ad limits")).toBeVisible();
  await makePro(harness.api, user.userId);
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
  await panel.getByRole("button", { name: "See my profit" }).click();
  await panel.getByRole("button", { name: "+1 free sample sent" }).click();
  await expect(panel.getByRole("button", { name: "+1 free sample sent (1)" })).toBeVisible();
  await page.reload();
  await expect(panel.getByRole("button", { name: "+1 free sample sent (1)" })).toBeVisible();
});

test("E-BILL-GRACE a failed invoice keeps Pro", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await makePro(harness.api, user.userId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  const failed = await harness.api.webhook("invoice.payment_failed", {
    id: "in_fail",
    object: "invoice",
    subscription: `sub_e2e_${user.userId}`,
  });
  expect(failed.ok).toBe(true);
  await expect(panel.getByRole("button", { name: "Upgrade" })).toHaveCount(0);
});

test("E-BILL-CANCEL-LIVE deleting the subscription returns the overlay to Free", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await makePro(harness.api, user.userId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  const deleted = await harness.api.webhook("customer.subscription.deleted", {
    id: `sub_e2e_${user.userId}`,
    object: "subscription",
    status: "canceled",
  });
  expect(deleted.ok).toBe(true);
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
});

test("E-BILL-LATE-INVOICE a late invoice.paid does not restore Pro", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await makePro(harness.api, user.userId);
  await harness.api.webhook("customer.subscription.deleted", {
    id: `sub_e2e_${user.userId}`,
    object: "subscription",
    status: "canceled",
  });
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await harness.api.webhook("invoice.paid", {
    id: "in_late",
    object: "invoice",
    subscription: `sub_e2e_${user.userId}`,
  });
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await expect.poll(async () => panel.getByRole("button", { name: "Upgrade" }).count()).toBe(1);
});

test("E-BILL-DONE-TAB the billing done page refreshes the tier", async ({ page, harness, context, extId }) => {
  const user = await freeUser(harness.api, context, extId);
  await makePro(harness.api, user.userId);
  await page.goto(`${harness.origin}/product/edit/real`);
  const done = await page.context().newPage();
  await done.goto("http://127.0.0.1:8000/billing/done?ok=1");
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  const no = await page.context().newPage();
  await no.goto("http://127.0.0.1:8000/billing/done?ok=0");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  await done.close();
  await no.close();
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
