import { requestCreditReport } from "@/lib/control/circuit";
import { devOnly } from "@/lib/control/identity";
import { resetStore, store } from "@/lib/control/store";
import { PERSONAS, type Bureau } from "@/lib/crs/personas";

const BUREAU_IDS: Bureau[] = ["transunion", "equifax", "experian"];

// POST { scenario: "dedup" | "budget" | "reset" }
// Unauthenticated and triggers real CRS pulls, so local development only.
export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;

  const { scenario } = (await request.json().catch(() => ({}))) as { scenario?: string };

  if (scenario === "reset") {
    resetStore();
    return Response.json({ ok: true });
  }

  if (scenario === "dedup") {
    // Three agents ask about the same applicant at the same moment.
    resetStore();
    await Promise.all(
      (["credit", "fraud", "payment"] as const).flatMap((agent) =>
        BUREAU_IDS.map((bureau) => requestCreditReport(agent, "P01", bureau)),
      ),
    );
    return Response.json({ ok: true, stats: store.stats, budget: store.budget });
  }

  if (scenario === "budget") {
    // 15 distinct pulls against a budget that only covers 5 of them.
    resetStore(10);
    await Promise.all(
      PERSONAS.flatMap((p) => BUREAU_IDS.map((bureau) => requestCreditReport("credit", p.id, bureau))),
    );
    return Response.json({ ok: true, stats: store.stats, budget: store.budget });
  }

  return Response.json({ error: "Unknown scenario" }, { status: 400 });
}
