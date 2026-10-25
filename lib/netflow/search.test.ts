import { describe, expect, it } from "vitest";
import { searchTerms } from "./search";
import { DEFAULT_SCENARIO, type Risks } from "./sim";
import type { RiskParams } from "./risk";

const mk = (pLate: number, pDefault: number): RiskParams => ({ pLate, meanDelayDays: 30, pDefault, lossGivenDefault: 0.6, drivers: [] });
const risks: Risks = { A: mk(0.42, 0.15), D: mk(0.12, 0.02), C: mk(0.05, 0.01), E: mk(0.3, 0.05) };

describe("searchTerms", () => {
  it("returns only candidates that satisfy every constraint", () => {
    const c = { minExpectedProfit: 5000, maxShortfallProb: 0.3, maxExtraFunds: 40000 };
    const { feasible } = searchTerms(DEFAULT_SCENARIO, risks, c, 400);
    for (const f of feasible) {
      expect(f.result.expectedProfit).toBeGreaterThanOrEqual(c.minExpectedProfit);
      expect(f.result.pShortfall).toBeLessThanOrEqual(c.maxShortfallProb);
    }
  });

  it("when nothing is feasible, reports which constraint is violated and by how much", () => {
    const { feasible, closest } = searchTerms(DEFAULT_SCENARIO, risks, { minExpectedProfit: 1e9, maxShortfallProb: 0, maxExtraFunds: 0 }, 300);
    expect(feasible).toHaveLength(0);
    expect(closest[0].violations.length).toBeGreaterThan(0);
  });
});
