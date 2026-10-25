import type { CrsResult } from "@/lib/crs/client";
import { BUREAUS, type Bureau } from "@/lib/crs/personas";
import { store } from "./store";

export type Decision = "APPROVE" | "REVIEW" | "DECLINE";
export type DecisionRoute = "payment" | "fraud" | "finish";

// What an agent learns about one pull. Agents never receive the raw CRS body.
export type BureauSummary = {
  bureau: Bureau;
  httpStatus: number;
  ok: boolean;
  status: string | null;
  scores: number[];
  errors: { code: string | null; text: string | null }[];
  requestId: string | null;
};

// What the policy sees for one bureau, read from AgentCircuit's own cache.
export type BureauFacts = {
  bureau: Bureau;
  label: string;
  available: boolean;
  status: string | null;
  scores: number[];
  errorCodes: string[];
  errorTexts: string[];
  requestId: string | null;
};

export type PolicyResult = { decision: Decision; route: DecisionRoute; rules: string[] };

export const BUREAU_ORDER: Bureau[] = ["transunion", "equifax", "experian"];

export const DECISION_ROUTES: Record<Decision, DecisionRoute> = {
  APPROVE: "payment",
  REVIEW: "fraud",
  DECLINE: "finish",
};

const MIN_SCORE = 660;
const MAX_SCORE_SPREAD = 50;
const DECEASED = /deceased/i;

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function summarizeCrs(bureau: Bureau, result: CrsResult): BureauSummary {
  const files = field(result.body, "creditFiles");
  const detail = field(Array.isArray(files) ? files[0] : undefined, "creditFileDetail");

  const scores: number[] = [];
  const rawScores = field(result.body, "scores");
  for (const entry of Array.isArray(rawScores) ? rawScores : []) {
    const value = field(entry, "scoreValue");
    // Skip null or blank values: Number(null) would read as a score of 0.
    if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) continue;
    const score = Number(value);
    if (Number.isFinite(score)) scores.push(score);
  }

  return {
    bureau,
    httpStatus: result.httpStatus,
    ok: result.ok,
    status: text(field(detail, "creditFileResultStatusType")),
    scores,
    errors: result.errorMessages.map((e) => ({
      code: text(field(e, "creditErrorMessageCode")),
      text: text(field(e, "creditErrorMessageText")),
    })),
    requestId: result.requestId,
  };
}

/** Facts for all three bureaus from completed pulls in the cache. */
export function collectFacts(personaId: string): BureauFacts[] {
  return BUREAU_ORDER.map((bureau) => {
    const label = BUREAUS[bureau].label;
    const result = store.cache.get(`credit_report:${personaId}:${bureau}`);
    if (!result) {
      return { bureau, label, available: false, status: null, scores: [], errorCodes: [], errorTexts: [], requestId: null };
    }
    const summary = summarizeCrs(bureau, result);
    return {
      bureau,
      label,
      available: true,
      status: summary.status,
      scores: summary.scores,
      errorCodes: summary.errors.flatMap((e) => (e.code ? [e.code] : [])),
      errorTexts: summary.errors.flatMap((e) => (e.text ? [e.text] : [])),
      requestId: summary.requestId,
    };
  });
}

/**
 * Underwriting policy. Every rule is evaluated; the most severe outcome wins
 * (DECLINE > REVIEW > APPROVE) and each triggered rule is listed as a reason.
 */
export function evaluatePolicy(facts: BureauFacts[]): PolicyResult {
  const decline: string[] = [];
  const review: string[] = [];

  const deceased = facts.filter(
    (f) => f.errorCodes.includes("E1200") || f.errorTexts.some((t) => DECEASED.test(t)),
  );
  if (deceased.length) decline.push(`Deceased indicator at ${deceased.map((f) => f.label).join(", ")}`);

  for (const f of facts) {
    if (!f.available) {
      review.push(`No data from ${f.label}`);
      continue;
    }
    const isDeceased = deceased.includes(f);
    // A deceased bureau's own error is already covered by the DECLINE rule.
    if (!isDeceased) {
      for (const code of f.errorCodes) review.push(`Bureau error ${code} at ${f.label}`);
      if (!f.errorCodes.length && f.errorTexts.length) review.push(`Bureau error at ${f.label}`);
    }
    const freeze = f.status !== null && /freeze/i.test(f.status);
    if (freeze) review.push(`Security freeze at ${f.label}`);
    else if (f.status !== null && f.status !== "FileReturned") review.push(`No file returned at ${f.label} (${f.status})`);
    // APPROVE claims every bureau returned a score, so a silent gap (e.g. an HTTP error) is reviewed.
    const flagged = isDeceased || f.errorCodes.length > 0 || f.errorTexts.length > 0 || (f.status !== null && f.status !== "FileReturned");
    if (!flagged && !f.scores.length) review.push(`No score from ${f.label}`);
  }

  const firstScores = facts.filter((f) => f.available && f.scores.length).map((f) => ({ label: f.label, score: f.scores[0] }));
  for (const { label, score } of firstScores) {
    if (score < MIN_SCORE) review.push(`Score ${score} below ${MIN_SCORE} at ${label}`);
  }
  if (firstScores.length > 1) {
    const values = firstScores.map((s) => s.score);
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > MAX_SCORE_SPREAD) review.push(`Bureau scores diverge by ${spread} points`);
  }

  if (decline.length) return { decision: "DECLINE", route: DECISION_ROUTES.DECLINE, rules: [...decline, ...review] };
  if (review.length) return { decision: "REVIEW", route: DECISION_ROUTES.REVIEW, rules: review };
  return {
    decision: "APPROVE",
    route: DECISION_ROUTES.APPROVE,
    rules: ["All three bureaus returned files with consistent scores of 660 or more"],
  };
}
