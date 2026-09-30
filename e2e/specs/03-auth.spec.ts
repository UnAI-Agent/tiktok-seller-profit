import { expect, test } from "../support/fixtures";
import { codeFor, email, PASSWORD, seedToken, sinkMessages, wipeExtension } from "../support/session";
import type { BrowserContext, Page } from "@playwright/test";

async function submitSignup(page: Page, origin: string, address: string, context: BrowserContext, extId: string, password = PASSWORD) {
  await wipeExtension(context, extId, page);
  await page.goto(`${origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Create free account" }).click();
  await panel.getByRole("tab", { name: "Create account" }).click();
  await panel.getByLabel("Email").fill(address);
  await panel.getByRole("textbox", { name: "Password" }).fill(password);
  await panel.getByRole("button", { name: "Create free account" }).click();
  return panel;
}

async function signup(page: Page, origin: string, address: string, context: BrowserContext, extId: string, password = PASSWORD) {
  const panel = await submitSignup(page, origin, address, context, extId, password);
  await expect(panel.getByRole("button", { name: "Overview" })).toBeVisible();
  return panel;
}

test("E-AUTH-WEAK a weak password shows the strength meter and the rule", async ({ page, harness, context, extId }) => {
  await wipeExtension(context, extId, page);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Create free account" }).click();
  await panel.getByRole("tab", { name: "Create account" }).click();
  await panel.getByRole("textbox", { name: "Password" }).fill("abc");
  await expect(panel.getByText("At least 8 characters")).toBeVisible();
  await expect(panel.getByText("3 of: A–Z, a–z, 0–9, symbol")).toBeVisible();
  await panel.getByLabel("Email").fill(email());
  await panel.getByRole("button", { name: "Create free account" }).click();
  await expect(panel.getByText("Password needs at least 3 of: uppercase, lowercase, number, special character")).toBeVisible();
});

test("E-AUTH-SIGNUP sign-up shows the nav and creates the user", async ({ page, harness, context, extId }) => {
  const address = email();
  const panel = await signup(page, harness.origin, address, context, extId);
  await expect(panel.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Products" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Settings" })).toBeVisible();
  const rows = (await harness.api.rows("users")) as { rows?: { email: string }[] };
  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
  expect(list.some((row) => row.email === address)).toBe(true);
});

test("E-AUTH-DUP a duplicate email is rejected", async ({ page, harness, context, extId }) => {
  const address = email();
  await harness.api.registerApi(address);
  const panel = await submitSignup(page, harness.origin, address, context, extId);
  await expect(panel.getByText("That email already has an account. Log in instead.")).toBeVisible();
});

test("E-AUTH-BADPW a wrong password is rejected", async ({ page, harness, context, extId }) => {
  const address = email();
  await harness.api.registerApi(address);
  await wipeExtension(context, extId, page);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Log in" }).click();
  await panel.getByLabel("Email").fill(address);
  await panel.getByRole("textbox", { name: "Password" }).fill("Wrong-pass-1");
  await panel.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(panel.getByText("Wrong password, or no account with that email.")).toBeVisible();
});

test("E-AUTH-LOGOUT log out returns the logged-out strip", async ({ page, harness, context, extId }) => {
  const address = email();
  const user = await harness.api.registerApi(address);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByRole("button", { name: "Overview" })).toBeVisible();
  await panel.getByRole("button", { name: "Account" }).click();
  await panel.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(panel.getByText("Profit on this page works without an account.")).toBeVisible();
});

test("E-AUTH-VERIFY the emailed code verifies the account", async ({ page, harness, context, extId }) => {
  const address = email();
  const panel = await signup(page, harness.origin, address, context, extId);
  const code = await codeFor(address);
  await panel.getByRole("button", { name: "Account" }).click();
  await panel.getByLabel("6-digit code").fill(code);
  await panel.getByRole("button", { name: "Verify", exact: true }).click();
  const token = await harness.api.loginApi(address);
  const me = await harness.api.me(token);
  expect(me.email_verified).toBe(true);
});

test("E-AUTH-VERIFY-BAD a wrong verify code is rejected", async ({ page, harness, context, extId }) => {
  const address = email();
  const panel = await signup(page, harness.origin, address, context, extId);
  await panel.getByRole("button", { name: "Account" }).click();
  await panel.getByLabel("6-digit code").fill("000000");
  await panel.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(panel.getByText("That code does not match.")).toBeVisible();
});

test("E-AUTH-RESEND resend within 60 seconds is rate limited", async ({ page, harness, context, extId }) => {
  const address = email();
  const panel = await signup(page, harness.origin, address, context, extId);
  await panel.getByRole("button", { name: "Account" }).click();
  await panel.getByRole("button", { name: "Send a new code" }).click();
  await panel.getByRole("button", { name: "Send a new code" }).click();
  await expect(panel.getByText("Too many requests. Please wait a moment.")).toBeVisible();
});

test("E-AUTH-RESET forgot password resets through the emailed link", async ({ page, harness, context, extId }) => {
  const address = email();
  await harness.api.registerApi(address);
  await wipeExtension(context, extId, page);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Log in" }).click();
  await panel.getByLabel("Email").fill(address);
  await panel.getByRole("button", { name: "Forgot password?" }).click();
  await panel.getByRole("button", { name: "Send reset link" }).click();
  let link = "";
  await expect.poll(async () => {
    const messages = await sinkMessages();
    const mine = [...messages].reverse().find((msg) => msg.body.includes("/auth/reset") && `${msg.to}\n${msg.body}`.toLowerCase().includes(address.toLowerCase()));
    link = mine?.body.match(/https?:\/\/\S+/)?.[0] ?? mine?.body.match(/\/auth\/reset\?token=\S+/)?.[0] ?? "";
    return link;
  }).not.toBe("");
  const url = link.startsWith("http") ? link : `http://127.0.0.1:8000${link}`;
  const reset = await page.context().newPage();
  await reset.goto(url.replace(/[>\])"']+$/, ""));
  await reset.locator("#pw").fill("Reset-pass-1");
  await reset.locator("#pw2").fill("Reset-pass-1");
  await reset.getByRole("button", { name: "Save new password" }).click();
  await expect(reset.getByText("password was updated")).toBeVisible();
  await reset.close();
  await page.reload();
  await panel.getByRole("button", { name: "Log in" }).click();
  await panel.getByLabel("Email").fill(address);
  await panel.getByRole("textbox", { name: "Password" }).fill("Reset-pass-1");
  await panel.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Overview" })).toBeVisible();
});

test("E-AUTH-REVOKE sign-out everywhere expires the overlay session", async ({ page, harness, context, extId }) => {
  const address = email();
  const first = await harness.api.registerApi(address);
  const second = await harness.api.loginApi(address);
  await seedToken(context, extId, first.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByRole("button", { name: "Overview" })).toBeVisible();
  const res = await fetch("http://127.0.0.1:8000/auth/sign-out-everywhere", {
    method: "POST",
    headers: { Authorization: `Bearer ${second}`, "Fly-Client-IP": "203.0.113.50" },
  });
  expect(res.ok).toBe(true);
  await expect(panel.getByText("Profit on this page works without an account.")).toBeVisible({ timeout: 15_000 });
});

test("E-AUTH-OAUTH-TICKET an OAuth ticket logs the seller tab in", async ({ page, harness, context, extId }) => {
  const address = email();
  const user = await harness.api.registerApi(address);
  const ticket = `e2e${Date.now()}oauthok`;
  const inserted = await fetch("http://127.0.0.1:8000/admin/db/rows", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": harness.api.adminKey,
      "Fly-Client-IP": "203.0.113.51",
    },
    body: JSON.stringify({
      table: "oauth_tickets",
      values: { ticket, user_id: user.userId, created_at: Math.floor(Date.now() / 1000), used: 0 },
    }),
  });
  if (!inserted.ok) throw new Error(await inserted.text());
  await wipeExtension(context, extId, page);
  await page.goto(`${harness.origin}/product/edit/real`);
  const done = await page.context().newPage();
  await done.goto(`http://127.0.0.1:8000/auth/oauth/done?ticket=${ticket}`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByRole("button", { name: "Overview" })).toBeVisible();
});

test("E-AUTH-SOCIAL-BUTTONS social buttons follow the provider list", async ({ page, harness, context, extId }) => {
  await wipeExtension(context, extId, page);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Log in" }).click();
  await expect(panel.getByRole("button", { name: "Google" })).toHaveCount(0);
  await harness.api.down();
  await harness.api.up({ GOOGLE_CLIENT_ID: "e2e-google", GOOGLE_CLIENT_SECRET: "e2e-secret" });
  await page.reload();
  await panel.getByRole("button", { name: "Log in" }).click();
  await expect(panel.getByRole("button", { name: "Google" })).toBeVisible();
  await harness.api.down();
  await harness.api.up();
});
