// Monte Carlo cash-flow simulation over a small fictional trade network.
// Money is in whole dollars. All companies and flows are fictional; only the
// owners' payment-risk inputs come from CRS sandbox evidence (see risk.ts).

import type { RiskParams } from "./risk";

export type Terms = {
  orderAmount: number; // customer A order value
  prepayPct: number; // 0..1 of order paid up front by A
  prepayDiscountPct: number; // 0..1 discount on the whole order if A prepays (applied pro rata to prepay share)
  dueDays: number; // days after delivery that the remainder is due
};

export type Scenario = {
  customerA: Terms;
  customerDOrder: number; // steady customer D: no prepay, net 30
  supplierC: { amount: number; dueDays: number; installments: 1 | 2 };
  supplierE: { amount: number; dueDays: number };
  b: { cash: number; creditLine: number; aprPct: number };
  stress: number; // multiplier on every late/default probability (1 = base)
  horizonDays: number;
};

export type Risks = { A: RiskParams; D: RiskParams; C: RiskParams; E: RiskParams };

export type SimResult = {
  trials: number;
  expectedProfit: number;
  profitP05: number;
  pGap: number; // P(B needs money beyond its own cash at some point)
  pShortfall: number; // P(funding need exceeds the emergency line)
  extraFundsP95: number; // 95th percentile of peak funding need
  cascadeExpected: number; // expected $ B fails to pay suppliers on the due date
  pCascade: number;
  cashCurve: { day: number; p05: number; p50: number; p95: number }[];
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Payment = { day: number; amount: number };

// Draws when/how much a payer actually pays. Returns the payments that arrive.
function drawPayment(rand: () => number, r: RiskParams, stress: number, dueDay: number, amount: number): Payment[] {
  const pLate = Math.min(0.95, r.pLate * stress);
  const pDef = Math.min(0.6, r.pDefault * stress);
  if (rand() < pDef) {
    // Defaulter pays only the recovered share (1 - LGD), late.
    return [{ day: dueDay + Math.round(r.meanDelayDays * 2), amount: amount * (1 - r.lossGivenDefault) }];
  }
  if (rand() < pLate) {
    const delay = Math.max(1, Math.round(-Math.log(1 - rand()) * r.meanDelayDays));
    return [{ day: dueDay + delay, amount }];
  }
  return [{ day: dueDay, amount }];
}

export function simulate(s: Scenario, risks: Risks, trials = 3000, seed = 42): SimResult {
  const rand = mulberry32(seed);
  const H = s.horizonDays;
  const profits: number[] = [];
  const peakNeeds: number[] = [];
  const cascades: number[] = [];
  const curves: number[][] = Array.from({ length: H + 1 }, () => []);
  let gap = 0;
  let shortfall = 0;
  let cascadeHit = 0;

  const A = s.customerA;
  const prepay = A.orderAmount * A.prepayPct;
  const discount = A.orderAmount * A.prepayPct * A.prepayDiscountPct;
  const aInvoice = A.orderAmount - prepay;
  const prepayNet = prepay - discount;

  for (let t = 0; t < trials; t++) {
    const inflow = new Float64Array(H + 61);
    const outflow = new Float64Array(H + 61);
    const add = (arr: Float64Array, p: Payment) => {
      if (p.day <= H) arr[Math.max(0, p.day)] += p.amount;
    };

    // Supplier risk: a late supplier delays B's delivery, shifting receipts.
    const cLate = rand() < Math.min(0.95, risks.C.pLate * s.stress * 0.5);
    const eLate = rand() < Math.min(0.95, risks.E.pLate * s.stress * 0.5);
    const shipDelay = Math.max(cLate ? Math.round(-Math.log(1 - rand()) * risks.C.meanDelayDays) : 0, eLate ? Math.round(-Math.log(1 - rand()) * risks.E.meanDelayDays) : 0);

    // Day 0: A's prepayment arrives (A's own default risk applies to the remainder).
    inflow[0] += prepayNet;
    for (const p of drawPayment(rand, risks.A, s.stress, 10 + shipDelay + A.dueDays, aInvoice)) add(inflow, p);
    for (const p of drawPayment(rand, risks.D, s.stress, 10 + shipDelay + 30, s.customerDOrder)) add(inflow, p);

    // B's scheduled obligations to suppliers.
    const cParts = s.supplierC.installments === 2 ? 2 : 1;
    const schedule: Payment[] = [];
    for (let i = 0; i < cParts; i++) {
      schedule.push({ day: s.supplierC.dueDays + i * 15, amount: s.supplierC.amount / cParts });
    }
    schedule.push({ day: s.supplierE.dueDays, amount: s.supplierE.amount });
    for (const p of schedule) add(outflow, p);

    // Walk the days. Negative cash is funded by the emergency line; the part
    // beyond the line is unpaid, which is the cascade to B's suppliers.
    let cash = s.b.cash;
    let peakNeed = 0;
    let interest = 0;
    let unpaidDue = 0;
    let revenue = 0;
    let cost = 0;
    for (let d = 0; d <= H; d++) {
      cash += inflow[d];
      revenue += inflow[d];
      const due = outflow[d];
      cost += due;
      cash -= due;
      const need = Math.max(0, -cash);
      if (need > peakNeed) peakNeed = need;
      if (need > s.b.creditLine) {
        // Can't fund beyond the line: the excess is not paid to suppliers on time.
        unpaidDue += Math.min(due, need - s.b.creditLine);
      }
      interest += (Math.min(need, s.b.creditLine) * (s.b.aprPct / 100)) / 365;
      curves[d].push(cash);
    }

    profits.push(revenue - cost - interest);
    peakNeeds.push(peakNeed);
    cascades.push(unpaidDue);
    if (peakNeed > 0) gap++;
    if (peakNeed > s.b.creditLine) shortfall++;
    if (unpaidDue > 0) cascadeHit++;
  }

  const q = (arr: number[], p: number) => {
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(p * a.length))];
  };
  const mean = (arr: number[]) => arr.reduce((x, y) => x + y, 0) / arr.length;

  return {
    trials,
    expectedProfit: mean(profits),
    profitP05: q(profits, 0.05),
    pGap: gap / trials,
    pShortfall: shortfall / trials,
    extraFundsP95: q(peakNeeds, 0.95),
    cascadeExpected: mean(cascades),
    pCascade: cascadeHit / trials,
    cashCurve: curves.map((c, day) => ({ day, p05: q(c, 0.05), p50: q(c, 0.5), p95: q(c, 0.95) })),
  };
}

export const DEFAULT_SCENARIO: Scenario = {
  customerA: { orderAmount: 60000, prepayPct: 0, prepayDiscountPct: 0.03, dueDays: 45 },
  customerDOrder: 30000,
  supplierC: { amount: 40000, dueDays: 45, installments: 1 },
  supplierE: { amount: 20000, dueDays: 60 },
  b: { cash: 15000, creditLine: 10000, aprPct: 18 },
  stress: 1,
  horizonDays: 120,
};
