import { crsPost } from "@/lib/crs/client";
import { BUREAUS, getPersona, pitchPointBody, type Bureau } from "@/lib/crs/personas";
import { summarizeCredit, summarizePitchPoint, type OwnerEvidence } from "@/lib/netflow/evidence";

// POST { personaId: "P08" } -> CRS evidence (3 bureaus + PitchPoint) for that owner persona.
export async function POST(request: Request) {
  const { personaId } = (await request.json().catch(() => ({}))) as { personaId?: string };
  const persona = personaId ? getPersona(personaId) : undefined;
  if (!persona) return Response.json({ error: "Unknown personaId" }, { status: 400 });

  try {
    const [bureaus, pp] = await Promise.all([
      Promise.all(
        (Object.keys(BUREAUS) as Bureau[]).map(async (b) =>
          summarizeCredit(b, await crsPost(BUREAUS[b].path, persona.creditBody)),
        ),
      ),
      crsPost("/pp/fcrablj/data", pitchPointBody(persona)),
    ]);
    const evidence: OwnerEvidence = {
      personaId: persona.id,
      name: persona.name,
      bureaus,
      publicRecords: summarizePitchPoint(pp),
      fetchedAt: new Date().toISOString(),
    };
    console.log(
      `[CRS] netflow ${persona.id} requestIds=${bureaus.map((b) => b.requestId).join(",")},${pp.requestId}`,
    );
    return Response.json(evidence);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "CRS call failed" }, { status: 502 });
  }
}
