import { shortAddress } from "@/lib/control/agent-signature";
import { devOnly, readSignedJson, registeredAgent } from "@/lib/control/identity";
import { AGENT_NAMES, logActivity, store } from "@/lib/control/store";
import type { ActivityType, AgentName } from "@/lib/control/store";

const PATH = "/api/control/activity";
const TYPES: ActivityType[] = [
  "AI_DECISION", "MESSAGE_SENT", "MESSAGE_RECEIVED",
  "SAFETY_OVERRIDE", "FRAUD_ASSESSMENT", "WORKFLOW_COMPLETE",
];
// Recorded by the decision route itself, so agents cannot forge them.
const SERVER_ONLY_TYPES: ActivityType[] = ["AI_DECISION", "SAFETY_OVERRIDE"];
const CHOICES = ["fraud", "payment", "finish"] as const;

const absent = (value: unknown) => value === undefined || value === null;

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Unavailable" }, { status: 404 });
  }
  return Response.json({ activity: store.activity }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;

  // Limit event payloads: no credit report contents or credentials here.
  const signed = await readSignedJson(request, PATH, { maxBytes: 4096, tooLarge: "Event too large" });
  if (!signed.ok) return signed.response;
  const { address, body: e } = signed;

  if (
    typeof e.type !== "string" || !TYPES.includes(e.type as ActivityType) ||
    typeof e.detail !== "string" || e.detail.length > 600 ||
    (!absent(e.target) &&
      (typeof e.target !== "string" || !AGENT_NAMES.includes(e.target as AgentName))) ||
    (!absent(e.choice) &&
      (typeof e.choice !== "string" || !CHOICES.includes(e.choice as typeof CHOICES[number]))) ||
    (!absent(e.model) && (typeof e.model !== "string" || e.model.length > 64))
  ) {
    return Response.json({ error: "Invalid event fields" }, { status: 400 });
  }

  // The acting agent is whoever signed, as bound in the registry.
  const agent = registeredAgent(address);
  if (!agent) {
    return Response.json({ error: `Unregistered agent ${shortAddress(address)}` }, { status: 403 });
  }
  if (!absent(e.agent) && e.agent !== agent.role) {
    return Response.json({ error: "Agent mismatch" }, { status: 403 });
  }
  const type = e.type as ActivityType;
  if (SERVER_ONLY_TYPES.includes(type)) {
    return Response.json({ error: `${type} is recorded by AgentCircuit, not by agents` }, { status: 403 });
  }

  logActivity({
    type,
    agent: agent.role,
    address,
    detail: e.detail,
    ...(e.target ? { target: e.target as AgentName } : {}),
    ...(e.choice ? { choice: e.choice as "fraud" | "payment" | "finish" } : {}),
    ...(e.model ? { model: e.model as string } : {}),
  });
  return Response.json({ ok: true });
}
