import { shortAddress } from "@/lib/control/agent-signature";
import { requestCreditReport } from "@/lib/control/circuit";
import { devOnly, readSignedJson, registeredAgent } from "@/lib/control/identity";
import { BUREAU_ORDER, summarizeCrs } from "@/lib/control/policy";
import { logEvent, store, type AgentName } from "@/lib/control/store";
import { getPersona, type Bureau } from "@/lib/crs/personas";

const PATH = "/api/control/agent-request";

// POST { personaId, bureau, claimedRole? }, signed by an enrolled uAgent.
// The role comes from the registry, never from the request body.
export async function POST(request: Request) {
  // Local development only, until deployment security is configured.
  const unavailable = devOnly();
  if (unavailable) return unavailable;

  const signed = await readSignedJson(request, PATH);
  if (!signed.ok) return signed.response;
  const { address, body } = signed;

  if (
    typeof body.personaId !== "string" || !getPersona(body.personaId) ||
    typeof body.bureau !== "string" || !BUREAU_ORDER.includes(body.bureau as Bureau)
  ) {
    return Response.json({ error: "Invalid persona or bureau" }, { status: 400 });
  }
  const claimedRole = body.claimedRole ?? null;
  if (claimedRole !== null && typeof claimedRole !== "string") {
    return Response.json({ error: "Invalid claimedRole" }, { status: 400 });
  }
  const personaId = body.personaId;
  const bureau = body.bureau as Bureau;
  const taskKey = `credit_report:${personaId}:${bureau}`;
  const agent = registeredAgent(address);

  const blockIdentity = (who: AgentName | "unknown", detail: string) => {
    store.stats.requested++;
    store.stats.blocked++;
    logEvent({ agent: who, taskKey, status: "blocked-identity", detail, address });
    return Response.json({ decision: "BLOCK", reason: "identity", detail }, { status: 403 });
  };
  if (!agent) return blockIdentity("unknown", `Unregistered agent ${shortAddress(address)}`);
  if (claimedRole !== null && claimedRole !== agent.role) {
    const claimed = claimedRole.slice(0, 64);
    return blockIdentity(agent.role, `Agent ${shortAddress(address)} is enrolled as ${agent.role} but claimed ${claimed}`);
  }

  const outcome = await requestCreditReport(agent.role, personaId, bureau, address);

  if (outcome.kind === "blocked") {
    return Response.json({ decision: "BLOCK", reason: outcome.reason, detail: outcome.detail });
  }
  if (outcome.kind === "failed") {
    return Response.json({ decision: "FAILED", detail: outcome.detail });
  }
  return Response.json({
    decision: outcome.source === "crs" ? "ALLOW" : "REUSE",
    source: outcome.source,
    success: outcome.result.ok,
    requestId: outcome.result.requestId,
    // A summary only: agents never receive the raw CRS body.
    summary: summarizeCrs(bureau, outcome.result),
  });
}
