import { isLocalRequest } from "@/lib/control/deployment";
import { devOnly } from "@/lib/control/identity";
import { crsPost } from "@/lib/crs/client";
import { BUREAUS, getPersona, type Bureau } from "@/lib/crs/personas";

// POST { personaId: "P01", bureau: "experian" }
// Unauthenticated and spends the team's CRS credentials, so only from this
// machine under `next dev`; never through a public tunnel.
export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;
  if (!isLocalRequest(request)) return Response.json({ error: "Local requests only" }, { status: 403 });

  const { personaId, bureau } = (await request.json().catch(() => ({}))) as {
    personaId?: string;
    bureau?: Bureau;
  };

  const persona = personaId ? getPersona(personaId) : undefined;
  if (!persona) return Response.json({ error: "Unknown personaId" }, { status: 400 });
  if (!bureau || !(bureau in BUREAUS)) return Response.json({ error: "Unknown bureau" }, { status: 400 });

  try {
    const result = await crsPost(BUREAUS[bureau].path, persona.creditBody);
    console.log(
      `[CRS] ${persona.id} ${bureau} http=${result.httpStatus} ok=${result.ok} requestId=${result.requestId} ${result.durationMs}ms`,
    );
    return Response.json({ personaId: persona.id, bureau, ...result });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "CRS call failed" }, { status: 502 });
  }
}
