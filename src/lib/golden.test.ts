import { describe, expect, it } from "vitest";
import golden from "../../qa/golden-cases.json";
import {
  breakEvenRoas,
  computeProfit,
  maxCpa,
  maxSafeCommissionPct,
  profitModel,
  targetPrice,
  type ProfitInput,
} from "./profit";
import { effectiveShippingPerUnit } from "./shippingCost";

type GoldenInput = {
  price: number;
  cogs: number;
  shippingPassedToBuyer: boolean;
  shipLabel: number;
  packaging: number;
  platformFeePct: number;
  paymentFeePct: number;
  paymentFixed: number;
  refundRatePct: number;
  salesTaxPct: number;
  affiliatePct: number;
  affiliateSharePct: number;
  adsPerUnit: number;
  targetMarginPct: number;
  samplesSent: number;
  sampleUnitCost: number;
  unitsSold: number;
  includeRefundAdminFee?: boolean;
};

type Expected = Record<string, number | null>;

const tol = golden.tolerance;

function toProfitInput(input: GoldenInput): ProfitInput {
  return {
    listPrice: input.price,
    unitsSold: input.unitsSold,
    cogsPerUnit: input.cogs,
    shippingOut: effectiveShippingPerUnit(input.shipLabel, input.shippingPassedToBuyer),
    packagingPerUnit: input.packaging,
    platformFeePct: input.platformFeePct,
    paymentFeePct: input.paymentFeePct,
    paymentFixed: input.paymentFixed,
    refundRatePct: input.refundRatePct,
    salesTaxPct: input.salesTaxPct,
    affiliatePct: input.affiliatePct,
    affiliateSharePct: input.affiliateSharePct,
    adsPerUnit: input.adsPerUnit,
    samplesSent: input.samplesSent,
    sampleUnitCost: input.sampleUnitCost,
    includeRefundAdminFee: input.includeRefundAdminFee ?? false,
    unrecoveredShipPerUnit: input.shippingPassedToBuyer ? input.shipLabel : 0,
  };
}

function actuals(input: GoldenInput): Expected {
  const profitInput = toProfitInput(input);
  const model = profitModel(profitInput);
  const result = computeProfit(profitInput);
  const commission = maxSafeCommissionPct(profitInput, input.targetMarginPct);
  const cpaEven = maxCpa(profitInput, 0);
  const cpaTarget = maxCpa(profitInput, input.targetMarginPct);
  return {
    sampleCostPerUnit: model.sampleCostPerUnit,
    fixedPerUnit: model.F,
    contribution: model.K,
    netDirect: result.netPerUnitDirect,
    netCreator: result.netPerUnitCreator,
    netBlended: result.netPerUnit,
    marginBlendedPct: result.netMarginPct,
    breakEvenPrice: result.breakEvenPrice,
    targetPrice: targetPrice(profitInput, input.targetMarginPct),
    maxCommissionBreakEvenPct: commission.breakEven,
    maxCommissionTargetPct: commission.atTarget,
    maxCpaDirectBreakEven: cpaEven.direct,
    maxCpaDirectTarget: cpaTarget.direct,
    maxCpaCreatorBreakEven: cpaEven.creator,
    maxCpaCreatorTarget: cpaTarget.creator,
    roasDirectBreakEven: breakEvenRoas(profitInput, 0, "direct"),
    roasDirectTarget: breakEvenRoas(profitInput, input.targetMarginPct, "direct"),
    roasCreatorBreakEven: breakEvenRoas(profitInput, 0, "creator"),
    roasCreatorTarget: breakEvenRoas(profitInput, input.targetMarginPct, "creator"),
  };
}

function toleranceFor(field: string): number {
  if (field.startsWith("roas")) return tol.ratio;
  if (field.includes("Pct") || field.includes("margin")) return tol.pct;
  return tol.money;
}

function expectMatch(actual: number | null, expected: number | null, field: string) {
  expect(actual === null || Number.isFinite(actual), field).toBe(true);
  if (expected === null) {
    expect(actual, field).toBeNull();
    return;
  }
  expect(actual, field).not.toBeNull();
  expect(Math.abs((actual as number) - expected), field).toBeLessThanOrEqual(toleranceFor(field));
}

describe("golden cases", () => {
  it("covers the 22 independent cases (3 with the refund admin fee)", () => {
    expect(golden.cases).toHaveLength(22);
  });

  for (const testCase of golden.cases) {
    it(testCase.name, () => {
      const got = actuals(testCase.input as GoldenInput);
      for (const [field, expected] of Object.entries(testCase.expected as Expected)) {
        expectMatch(got[field], expected, `${testCase.name}.${field}`);
      }
    });
  }
});
