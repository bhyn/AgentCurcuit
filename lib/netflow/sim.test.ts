import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, simulate, type Risks } from "./sim";
import type { RiskParams } from "./risk";

const safe: RiskParams = { pLate: 0, meanDelayDays: 20, pDefault: 0, lossGivenDefault: 0.6, drivers: [] };
const risky: RiskParams = { pLate: 0.5, meanDelayDays: 35, pDefault: 0.1, lossGivenDefault: 0.6, drivers: [] };
const allSafe: Risks = { A: safe, D: safe, C: safe, E: safe };

describe("simulate", () => {
  it("is deterministic for a fixed seed", () => {
    const a = simulate(DEFAULT_SCENARIO, allSafe, 500, 7);
    const b = simulate(DEFAULT_SCENARIO, allSafe, 500, 7);
    expect(a.expectedProfit).toBe(b.expectedProfit);
  });

  it("with no risk, profit equals revenue minus costs and never defaults", () => {
    const r = simulate(DEFAULT_SCENARIO, allSafe, 200, 1);
    expect(r.cascadeExpected).toBe(0);
    expect(r.profitP05).toBeCloseTo(r.expectedProfit, 2); // every trial identical
  });

  it("a riskier customer lowers expected profit and raises shortfall", () => {
    const base = simulate(DEFAULT_SCENARIO, allSafe, 2000, 3);
    const bad = simulate(DEFAULT_SCENARIO, { ...allSafe, A: risky }, 2000, 3);
    expect(bad.expectedProfit).toBeLessThan(base.expectedProfit);
    expect(bad.pShortfall).toBeGreaterThanOrEqual(base.pShortfall);
  });

  it("prepayment reduces shortfall for a risky customer", () => {
    const risks: Risks = { ...allSafe, A: risky };
    const none = simulate(DEFAULT_SCENARIO, risks, 3000, 5);
    const prepaid = simulate(
      { ...DEFAULT_SCENARIO, customerA: { ...DEFAULT_SCENARIO.customerA, prepayPct: 0.4 } },
      risks,
      3000,
      5,
    );
    expect(prepaid.pShortfall).toBeLessThan(none.pShortfall);
  });
});
