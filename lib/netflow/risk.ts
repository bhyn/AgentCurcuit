import type { OwnerEvidence } from "./evidence";

// ILLUSTRATIVE mapping from owner-level CRS evidence to payment behaviour.
// Not calibrated to real default data and not a CRS output. Every number here
// is a demo assumption and is shown to the user as such.

export type RiskParams = {
  pLate: number; // probability a payment arrives late
  meanDelayDays: number; // average extra days when late
  pDefault: number; // probability the payment is never made (of the unpaid part)
  lossGivenDefault: number; // share of the unpaid amount that is never recovered
  drivers: Driver[]; // structured reasons, rendered (and translated) by the UI
};

export type Driver = {
  key: "score" | "noScore" | "partialNoScore" | "collections" | "derog" | "bkActive" | "bkDischarged" | "judgments" | "liens";
  n?: number;
  amount?: number;
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function baseLateFromScore(score: number): number {
  if (score >= 760) return 0.05;
  if (score >= 700) return 0.12;
  if (score >= 650) return 0.2;
  if (score >= 600) return 0.3;
  return 0.42;
}

export function riskFromEvidence(ev: OwnerEvidence): RiskParams {
  const drivers: Driver[] = [];
  const scored = ev.bureaus.filter((b) => b.score !== null);
  const noScore = ev.bureaus.filter((b) => b.score === null);

  let pLate: number;
  if (scored.length) {
    // Conservative: judge by the weakest bureau score, and say which models were used.
    const worst = Math.min(...scored.map((b) => b.score as number));
    pLate = baseLateFromScore(worst);
    drivers.push({ key: "score", n: worst });
  } else {
    pLate = 0.3;
    drivers.push({ key: "noScore" });
  }
  if (scored.length && noScore.length) {
    pLate += 0.04 * noScore.length;
    drivers.push({ key: "partialNoScore", n: noScore.length });
  }

  const collections = Math.max(0, ...ev.bureaus.map((b) => b.collections));
  const chargeOffs = Math.max(0, ...ev.bureaus.map((b) => b.chargeOffs));
  if (collections) {
    pLate += 0.04 * collections;
    drivers.push({ key: "collections", n: collections });
  }
  if (chargeOffs) {
    pLate += 0.05 * chargeOffs;
    drivers.push({ key: "derog", n: chargeOffs });
  }

  const bk = ev.bureaus.some((b) => b.bankruptcy === "active")
    ? "active"
    : ev.bureaus.some((b) => b.bankruptcy === "discharged")
      ? "discharged"
      : "none";
  if (bk === "active") {
    pLate += 0.15;
    drivers.push({ key: "bkActive" });
  } else if (bk === "discharged") {
    pLate += 0.05;
    drivers.push({ key: "bkDischarged" });
  }

  const pr = ev.publicRecords;
  let unsatisfied = 0;
  if (pr) {
    const openJ = pr.judgments.filter((j) => j.status !== "Satisfied");
    const openL = pr.liens.filter((l) => l.status !== "Released");
    unsatisfied = openJ.length + openL.length;
    if (openJ.length) drivers.push({ key: "judgments", n: openJ.length, amount: openJ.reduce((s, j) => s + j.amount, 0) });
    if (openL.length) drivers.push({ key: "liens", n: openL.length, amount: openL.reduce((s, l) => s + l.amount, 0) });
    pLate += 0.07 * unsatisfied;
  }

  pLate = clamp(pLate, 0.02, 0.75);
  const hasSevere = bk === "active" || unsatisfied > 0;
  return {
    pLate,
    meanDelayDays: hasSevere ? 35 : 20,
    pDefault: clamp(0.005 + pLate * 0.12 + (bk === "active" ? 0.05 : 0), 0.005, 0.25),
    lossGivenDefault: 0.6,
    drivers,
  };
}
