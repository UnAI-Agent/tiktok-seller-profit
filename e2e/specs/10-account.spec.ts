import { expect, test } from "../support/fixtures";
import { email, PASSWORD, seedToken } from "../support/session";

async function account(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext, extId: string, api: import("../support/backend").Api, origin: string) {
  const address = email();
  const user = await api.registerApi(address);
  await seedToken(context, extId, user.token);
  await page.goto(`${origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Account" }).click();
  return { panel, address, user };
}

test("E-ACC-NAME the display name can be changed", async ({ page, harness, context, extId }) => {
  const { panel } = await account(page, context, extId, harness.api, harness.origin);
  await panel.getByPlaceholder("Your name").fill("Ada Seller");
  await panel.getByRole("button", { name: "Save profile" }).click();
  await expect(panel.getByText("Profile saved.")).toBeVisible();
  await expect(panel.getByText("Ada Seller").first()).toBeVisible();
});

test("E-ACC-EMAIL changing the email clears verification", async ({ page, harness, context, extId }) => {
  const { panel, address, user } = await account(page, context, extId, harness.api, harness.origin);
  await harness.api.verifyEmail(user.userId, "");
  // Save compares against the loaded profile. Clicking before that load finishes
  // shows "Profile saved." and the test then waits out the whole 90s.
  await expect(panel.getByRole("textbox", { name: "Email" })).toHaveValue(address);
  const next = email();
  await panel.getByRole("textbox", { name: "Email" }).fill(next);
  await panel.getByRole("button", { name: "Save profile" }).click();
  await expect(panel.getByText("Saved. Verify your new email address to start a trial.")).toBeVisible();
  const me = await harness.api.me(user.token);
  expect(me.email_verified).toBe(false);
});

test("E-ACC-PASSWORD a password change keeps this session and rejects the old token", async ({ page, harness, context, extId, extPage }) => {
  const { panel, address, user } = await account(page, context, extId, harness.api, harness.origin);
  const old = await harness.api.loginApi(address);
  await panel.getByLabel("Current password").fill("Wrong-pass-1");
  await panel.getByRole("textbox", { name: "New password" }).first().fill("Next-pass-1");
  await panel.getByLabel("Confirm new password").fill("Next-pass-1");
  await panel.getByRole("button", { name: "Update password" }).click();
  await expect(panel.getByText("Current password is wrong.")).toBeVisible();
  await panel.getByLabel("Current password").fill(PASSWORD);
  await panel.getByRole("textbox", { name: "New password" }).first().fill("Next-pass-1");
  await panel.getByRole("textbox", { name: "Confirm new password" }).first().fill("Next-pass-1");
  await panel.getByRole("button", { name: "Update password" }).click();
  await expect(panel.getByText("Password updated. Your other devices were signed out.")).toBeVisible();
  const stale = await fetch("http://127.0.0.1:8000/auth/me", {
    headers: { Authorization: `Bearer ${old}`, "Fly-Client-IP": "203.0.113.70" },
  });
  expect(stale.status).toBe(401);
  const kept = await extPage.evaluate(() => chrome.storage.local.get("authToken").then((data) => String(data.authToken ?? "")));
  const current = await harness.api.me(kept);
  expect(current.email).toBe(address);
});

test("E-ACC-SIGNOUT-ALL sign out everywhere from the account panel", async ({ page, harness, context, extId }) => {
  const { panel } = await account(page, context, extId, harness.api, harness.origin);
  await panel.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(panel.getByText("Profit on this page works without an account.")).toBeVisible();
});

test("E-ACC-DELETE deleting the account removes the user", async ({ page, harness, context, extId }) => {
  const { panel, address } = await account(page, context, extId, harness.api, harness.origin);
  await panel.getByText("Delete account").click();
  await panel.getByRole("textbox", { name: "Password" }).last().fill(PASSWORD);
  await panel.getByRole("button", { name: "Delete my account" }).click();
  await expect(panel.getByText("Profit on this page works without an account.")).toBeVisible();
  // Search for this email: an unfiltered first page of rows could miss it and pass anyway.
  const found = (await harness.api.rows("users", address)) as { rows: Array<{ email: string }> };
  expect(found.rows.filter((row) => row.email === address)).toHaveLength(0);
});
