// Plain-data summary of what CRS returned for one owner persona.
// Pure (no server-only) so the browser can use it for risk mapping.

export type BureauEvidence = {
  bureau: "transunion" | "equifax" | "experian";
  httpStatus: number;
  requestId: string | null;
  fileStatus: string; // e.g. FileReturned, NoFileReturnedNoHit, NoFileReturnedCreditFreeze, error
  score: number | null;
  modelName: string | null;
  collections: number;
  chargeOffs: number;
  bankruptcy: "none" | "discharged" | "active";
  errors: string[];
};

export type PublicRecordEvidence = {
  httpStatus: number;
  requestId: string | null;
  judgments: { amount: number; status: string }[];
  liens: { amount: number; status: string }[];
  bankruptcies: number;
  errors: string[];
};

export type OwnerEvidence = {
  personaId: string;
  name: string;
  bureaus: BureauEvidence[];
  publicRecords: PublicRecordEvidence | null;
  fetchedAt: string;
};

type Obj = Record<string, unknown>;
const asArray = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : v ? [v as Obj] : []);

export function summarizeCredit(
  bureau: BureauEvidence["bureau"],
  r: { httpStatus: number; requestId: string | null; errorMessages: { creditErrorMessageText?: string }[]; body: unknown },
): BureauEvidence {
  const body = (r.body ?? {}) as Obj;
  const scores = asArray(body.scores);
  const first = scores[0] ?? {};
  const scoreNum = Number(first.scoreValue);
  const files = asArray(body.creditFiles);
  const status = (files[0]?.creditFileDetail as Obj | undefined)?.creditFileResultStatusType;
  const tradelines = asArray(body.tradelines);
  const pubs = asArray(body.publicRecords);

  let bankruptcy: BureauEvidence["bankruptcy"] = "none";
  for (const p of pubs) {
    if (String(p.publicRecordType ?? "").startsWith("Bankruptcy")) {
      bankruptcy = String(p.dispositionType) === "Discharged" ? (bankruptcy === "active" ? "active" : "discharged") : "active";
    }
  }

  return {
    bureau,
    httpStatus: r.httpStatus,
    requestId: r.requestId,
    fileStatus: r.errorMessages.length && !files.length ? "error" : String(status ?? "unknown"),
    score: Number.isFinite(scoreNum) && first.scoreValue != null ? scoreNum : null,
    modelName: (first.modelName as string | undefined) ?? null,
    collections: tradelines.filter((t) => t.loanType === "Collection").length,
    // Sandbox files carry a chargeOffAmount on every tradeline, so use the derogatory flag instead.
    chargeOffs: tradelines.filter((t) => t.derogatoryDataIndicator === true && t.loanType !== "Collection").length,
    bankruptcy,
    errors: r.errorMessages.map((e) => e.creditErrorMessageText ?? "error"),
  };
}

export function summarizePitchPoint(r: {
  httpStatus: number;
  requestId: string | null;
  errorMessages: { creditErrorMessageText?: string }[];
  body: unknown;
}): PublicRecordEvidence {
  const report = ((r.body as Obj | null)?.DetailedBLJReport ?? {}) as Obj;
  const results = (report.Results ?? {}) as Obj;
  const judgments = asArray((results.Judgments as Obj | undefined)?.JudgmentRecord).map((j) => ({
    amount: Number(j.TotalJudgmentAmount) || 0,
    status: String(j.Status ?? "Unknown"),
  }));
  const liens = asArray((results.Liens as Obj | undefined)?.LienRecord).map((l) => ({
    amount: Number(l.TotalLienAmount) || 0,
    status: String(l.Status ?? "Unknown"),
  }));
  return {
    httpStatus: r.httpStatus,
    requestId: r.requestId,
    judgments,
    liens,
    bankruptcies: Number(report.BankruptciesFound) || 0,
    errors: r.errorMessages.map((e) => e.creditErrorMessageText ?? "error"),
  };
}
