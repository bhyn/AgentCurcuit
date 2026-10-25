import { simulate, type Risks, type Scenario, type SimResult } from "./sim";

export type Constraints = {
  minExpectedProfit: number;
  maxShortfallProb: number; // P(need exceeds emergency line)
  maxExtraFunds: number; // 95th percentile peak funding need
};

export type Candidate = {
  scenario: Scenario;
  result: SimResult;
  label: string;
  violations: { constraint: keyof Constraints; by: number }[];
};

// Materials for A's order scale with the order size (70% of supplier amounts are order-driven).
const ORDER_DRIVEN_SHARE = 0.7;

export function searchTerms(base: Scenario, risks: Risks, c: Constraints, trials = 1000): { feasible: Candidate[]; closest: Candidate[] } {
  const all: Candidate[] = [];
  for (const orderFactor of [1, 0.75, 0.5]) {
    const orderAmount = Math.round(base.customerA.orderAmount * orderFactor);
    const scale = 1 - (1 - orderFactor) * ORDER_DRIVEN_SHARE;
    for (const prepayPct of [0, 0.15, 0.3, 0.45, 0.6]) {
      for (const prepayDiscountPct of prepayPct === 0 ? [0] : [0.03, 0.06]) {
        for (const dueDays of [30, 45, 60]) {
          for (const installments of [1, 2] as const) {
            const scenario: Scenario = {
              ...base,
              customerA: { orderAmount, prepayPct, prepayDiscountPct, dueDays },
              supplierC: { ...base.supplierC, amount: Math.round(base.supplierC.amount * scale), installments },
              supplierE: { ...base.supplierE, amount: Math.round(base.supplierE.amount * scale) },
            };
            const result = simulate(scenario, risks, trials, 11);
            const violations: Candidate["violations"] = [];
            if (result.expectedProfit < c.minExpectedProfit) violations.push({ constraint: "minExpectedProfit", by: c.minExpectedProfit - result.expectedProfit });
            if (result.pShortfall > c.maxShortfallProb) violations.push({ constraint: "maxShortfallProb", by: result.pShortfall - c.maxShortfallProb });
            if (result.extraFundsP95 > c.maxExtraFunds) violations.push({ constraint: "maxExtraFunds", by: result.extraFundsP95 - c.maxExtraFunds });
            all.push({
              scenario,
              result,
              violations,
              label: `order ${Math.round(orderFactor * 100)}%, prepay ${Math.round(prepayPct * 100)}%${prepayPct ? ` (−${Math.round(prepayDiscountPct * 100)}%)` : ""}, net ${dueDays}d, C in ${installments}`,
            });
          }
        }
      }
    }
  }
  const feasible = all.filter((x) => x.violations.length === 0).sort((a, b) => b.result.expectedProfit - a.result.expectedProfit);
  const closest = all
    .filter((x) => x.violations.length > 0)
    .sort((a, b) => a.violations.length - b.violations.length || b.result.expectedProfit - a.result.expectedProfit);
  return { feasible: feasible.slice(0, 3), closest: closest.slice(0, 3) };
}
