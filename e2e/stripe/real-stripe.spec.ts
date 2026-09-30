import { test } from "../support/fixtures";

test("E-STRIPE-REAL real Stripe test-mode checkout", async () => {
  test.skip(!process.env.E2E_STRIPE, "E2E_STRIPE is not set");
});
