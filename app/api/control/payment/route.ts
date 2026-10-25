import { shortAddress } from "@/lib/control/agent-signature";
import { devOnly, readSignedJson, registeredAgent } from "@/lib/control/identity";
import { logEvent, store } from "@/lib/control/store";
import { getPersona } from "@/lib/crs/personas";

const PATH = "/api/control/payment";

// POST { personaId } from the payment agent. Simulated: nothing is disbursed.
// Authorized only when AgentCircuit's own policy decision for the persona is APPROVE.
export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;

  const signed = await readSignedJson(request, PATH);
  if (!signed.ok) return signed.response;
  const { address, body } = signed;

  if (typeof body.personaId !== "string" || !getPersona(body.personaId)) {
    return Response.json({ error: "Invalid personaId" }, { status: 400 });
  }
  const personaId = body.personaId;
  const taskKey = `payment:${personaId}`;

  const agent = registeredAgent(address);
  if (!agent) {
    return Response.json({ error: `Unregistered agent ${shortAddress(address)}` }, { status: 403 });
  }
  if (agent.role !== "payment") {
    const error = `${agent.role} agent may not request payments`;
    logEvent({ agent: agent.role, taskKey, status: "blocked-permission", detail: error, address });
    return Response.json({ error }, { status: 403 });
  }

  const record = store.decisions.get(personaId);
  if (record?.final === "APPROVE") {
    const detail = `Disbursement authorized for ${personaId} (simulated)`;
    logEvent({ agent: "payment", taskKey, status: "payment-authorized", detail, address });
    return Response.json({ decision: "AUTHORIZED", detail });
  }

  const detail = `No approved underwriting decision for ${personaId}${record ? ` (policy: ${record.final})` : ""}`;
  logEvent({ agent: "payment", taskKey, status: "blocked-payment", detail, address });
  return Response.json({ decision: "BLOCK", reason: "no-approval", detail });
}
