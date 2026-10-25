import { shortAddress } from "@/lib/control/agent-signature";
import { devOnly, readSignedJson, registeredAgent } from "@/lib/control/identity";
import { logActivity } from "@/lib/control/store";

// AI plans are recorded by AgentCircuit after verifying the Credit Agent's signature.
// The general activity endpoint intentionally still rejects direct AI_DECISION posts.
const PATH = "/api/control/ai-plan";
const PROVIDERS = ["gemini", "ollama"] as const;
const STAGES = ["after_credit", "after_fraud"] as const;
const AGENTS = ["fraud", "payment", "finish"] as const;
const TASKS = [
  "none", "review_fraud", "payment_credit_access",
  "x402_payment_dry_run", "x402_over_budget_dry_run",
] as const;

export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;

  const signed = await readSignedJson(request, PATH, {
    maxBytes: 2048,
    tooLarge: "AI plan too large",
  });
  if (!signed.ok) return signed.response;
  const { address, body } = signed;

  const actor = registeredAgent(address);
  if (!actor) {
    return Response.json({ error: `Unregistered agent ${shortAddress(address)}` }, { status: 403 });
  }
  if (actor.role !== "credit") {
    return Response.json({ error: "Only Credit Agent may record AI plans" }, { status: 403 });
  }

  const { provider, model, stage, next_agent: nextAgent, task, reason } = body;
  if (
    typeof provider !== "string" || !PROVIDERS.includes(provider as typeof PROVIDERS[number]) ||
    typeof model !== "string" || model.length < 1 || model.length > 64 ||
    typeof stage !== "string" || !STAGES.includes(stage as typeof STAGES[number]) ||
    typeof nextAgent !== "string" || !AGENTS.includes(nextAgent as typeof AGENTS[number]) ||
    typeof task !== "string" || !TASKS.includes(task as typeof TASKS[number]) ||
    typeof reason !== "string" || reason.trim().length < 1 || reason.length > 280
  ) {
    return Response.json({ error: "Invalid AI plan fields" }, { status: 400 });
  }

  const valid = (nextAgent === "fraud" && task === "review_fraud" && stage === "after_credit") ||
    (nextAgent === "payment" && ["payment_credit_access", "x402_payment_dry_run", "x402_over_budget_dry_run"].includes(task)) ||
    (nextAgent === "finish" && task === "none");
  if (!valid) return Response.json({ error: "Invalid AI agent/task pair" }, { status: 400 });

  // Never include raw prompts, credit report bodies, private keys or API tokens.
  const safeReason = reason.trim().replace(/[\r\n\t]+/g, " ");
  logActivity({
    type: "AI_DECISION",
    agent: "credit",
    address,
    choice: nextAgent as "fraud" | "payment" | "finish",
    model: `${provider === "gemini" ? "Gemini" : "Ollama"} / ${model}`.slice(0, 64),
    detail: `${stage} | task: ${task} | reason: ${safeReason}`.slice(0, 600),
  });
  return Response.json({ ok: true });
}
