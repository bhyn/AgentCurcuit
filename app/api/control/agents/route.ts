import { devOnly, hasOperatorToken, readSignedJson, registeredAgent } from "@/lib/control/identity";
import { AGENT_NAMES, logEvent, store, type AgentName } from "@/lib/control/store";

const PATH = "/api/control/agents";
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

// POST { role, name }: operator token AND the enrolling agent's own signature,
// so an address can only be bound by whoever holds its key.
export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;
  if (!hasOperatorToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const signed = await readSignedJson(request, PATH);
  if (!signed.ok) return signed.response;
  const { address, body } = signed;

  if (
    typeof body.role !== "string" || !AGENT_NAMES.includes(body.role as AgentName) ||
    typeof body.name !== "string" || !NAME.test(body.name)
  ) {
    return Response.json({ error: "Invalid role or name" }, { status: 400 });
  }
  const role = body.role as AgentName;
  const name = body.name;
  const taskKey = `identity:${address}`;
  const existing = registeredAgent(address);

  if (existing && existing.role !== role) {
    logEvent({
      agent: existing.role,
      taskKey,
      status: "blocked-identity",
      detail: `Re-enrollment as ${role} rejected: address is bound to ${existing.role}`,
      address,
    });
    return Response.json({ error: `Address already enrolled as ${existing.role}` }, { status: 409 });
  }
  if (existing) {
    return Response.json({ ok: true, address, role, name: existing.name, alreadyEnrolled: true });
  }

  store.agents.set(address, { address, role, name, enrolledAt: Date.now() });
  logEvent({ agent: role, taskKey, status: "enrolled", detail: `Enrolled ${name} as ${role} agent`, address });
  return Response.json({ ok: true, address, role, name, alreadyEnrolled: false });
}
