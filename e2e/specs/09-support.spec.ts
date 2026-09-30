import { expect, test } from "../support/fixtures";
import { email, seedToken, sinkMessages } from "../support/session";

test("E-SUP-SUBMIT a support ticket is stored and emailed", async ({ page, harness, context, extId }) => {
  const address = email();
  const user = await harness.api.registerApi(address);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Help & support" }).click();
  await expect(panel.getByLabel("Your email")).toHaveValue(address);
  await panel.getByLabel("Message").fill("The price on this listing looks wrong today.");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText("Message received")).toBeVisible();
  const rows = await harness.api.rows("support_tickets");
  const text = JSON.stringify(rows);
  expect(text).toContain(address);
  expect(text).toContain("The price on this listing looks wrong today.");
  const mail = await sinkMessages();
  expect(mail.some((msg) => (msg.subject ?? msg.body).includes("[problem]"))).toBe(true);
});

test("E-SUP-CONTEXT the support message includes page context", async ({ page, harness, context, extId }) => {
  const address = email();
  const user = await harness.api.registerApi(address);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Help & support" }).click();
  await panel.getByLabel("Message").fill("Please look at the price read on this page.");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText("Message received")).toBeVisible();
  const rows = JSON.stringify(await harness.api.rows("support_tickets"));
  expect(rows).toContain("Extension version");
  expect(rows).toContain("Price read");
});

test("E-SUP-BAD-EMAIL an invalid support email is rejected", async ({ page, harness }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Help & support" }).click();
  await panel.getByLabel("Your email").fill("not-an-email");
  await panel.getByLabel("Message").fill("This message is long enough to send.");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText("Enter the email where we can reply.")).toBeVisible();
});

test("E-SUP-RATE the sixth support ticket in a minute is rate limited", async ({ page, harness }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  const address = email();
  for (let i = 0; i < 5; i += 1) {
    await panel.getByRole("button", { name: "Help & support" }).click();
    await panel.getByLabel("Your email").fill(address);
    await panel.getByLabel("Message").fill(`Ticket number ${i} is long enough to send.`);
    await panel.getByRole("button", { name: "Send message" }).click();
    await expect(panel.getByText("Message received")).toBeVisible();
    await panel.getByRole("button", { name: "Back to MarginMark" }).click();
  }
  await panel.getByRole("button", { name: "Help & support" }).click();
  await panel.getByLabel("Your email").fill(address);
  await panel.getByLabel("Message").fill("This sixth ticket should be rate limited.");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText(/Too many requests|rate/i).first()).toBeVisible();
});
