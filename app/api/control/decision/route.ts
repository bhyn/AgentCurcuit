import { shortAddress } from "@/lib/control/agent-signature";
import { devOnly, readSignedJson, registeredAgent } from "@/lib/control/identity";
import { collectFacts, evaluatePolicy, type Decision } from "@/lib/control/policy";
import { logActivity, logEvent, store, type DecisionRecord } from "@/lib/control/store";
import { getPersona } from "@/lib/crs/personas";

const PATH = "/api/control/decision";
const RECOMMENDATIONS: Decision[] = ["APPROVE", "REVIEW", "DECLINE"];

// null = no proposal; undefined = malformed.
function parseProposal(value: unknown): DecisionRecord["proposal"] | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const { recommendation, reason } = value as Record<string, unknown>;
  if (typeof recommendation !== "string" || !RECOMMENDATIONS.includes(recommendation as Decision)) return undefined;
  if (typeof reason !== "string" || reason.trim().length > 600) return undefined;
  return { recommendation: recommendation as Decision, reason: reason.trim() };
}

// null = not given; undefined = malformed.
function parseModel(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 64) return undefined;
  return value.trim() || null;
}

// POST { personaId, proposal: { recommendation, reason } | null, model? } from the credit agent.
// The AI only proposes: AgentCircuit re-reads its own cached CRS data and its policy decides.
export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;

  const signed = await readSignedJson(request, PATH);
  if (!signed.ok) return signed.response;
  const { address, body } = signed;

  if (typeof body.personaId !== "string" || !getPersona(body.personaId)) {
    return Response.json({ error: "Invalid personaId" }, { status: 400 });
  }
  const proposal = parseProposal(body.proposal);
  if (proposal === undefined) return Response.json({ error: "Invalid proposal" }, { status: 400 });
  const model = parseModel(body.model);
  if (model === undefined) return Response.json({ error: "Invalid model" }, { status: 400 });
  const personaId = body.personaId;
  const taskKey = `decision:${personaId}`;

  const agent = registeredAgent(address);
  if (!agent) {
    return Response.json({ error: `Unregistered agent ${shortAddress(address)}` }, { status: 403 });
  }
  if (agent.role !== "credit") {
    const error = `${agent.role} agent may not submit underwriting decisions`;
    logEvent({ agent: agent.role, taskKey, status: "blocked-permission", detail: error, address });
    return Response.json({ error }, { status: 403 });
  }

  const facts = collectFacts(personaId);
  const policy = evaluatePolicy(facts);
  const overridden = proposal !== null && proposal.recommendation !== policy.decision;
  const record: DecisionRecord = {
    personaId,
    final: policy.decision,
    route: policy.route,
    overridden,
    rules: policy.rules,
    proposal,
    model,
    facts,
    ts: Date.now(),
    address,
  };
  store.decisions.set(personaId, record);

  const reasons = policy.rules.join("; ");
  const outcome = `policy ${policy.decision}`;
  const explain = !proposal || overridden || policy.decision !== "APPROVE";
  logEvent({
    agent: "credit",
    taskKey,
    status: !proposal ? "decision-policy-only" : overridden ? "decision-overridden" : "decision-confirmed",
    detail:
      (proposal ? `${model ?? "AI"} proposed ${proposal.recommendation}; ` : "No AI proposal; ") +
      (explain ? `${outcome} (${reasons})` : outcome),
    address,
  });
  logActivity({
    type: "AI_DECISION",
    agent: "credit",
    address,
    detail: proposal ? `Proposed ${proposal.recommendation}: ${proposal.reason}` : "No AI proposal; policy only",
    choice: policy.route,
    ...(model ? { model } : {}),
  });
  if (proposal && overridden) {
    logActivity({
      type: "SAFETY_OVERRIDE",
      agent: "credit",
      address,
      detail: `AgentCircuit policy overrode ${proposal.recommendation} -> ${policy.decision}: ${reasons}`,
      choice: policy.route,
    });
  }

  return Response.json({
    personaId,
    final: record.final,
    route: record.route,
    overridden,
    rules: record.rules,
    proposal,
    model,
    facts,
  });
}
