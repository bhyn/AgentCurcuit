
import {
  devOnly,
  readSignedJson,
  registeredAgent,
} from "@/lib/control/identity";
import { logActivity } from "@/lib/control/store";



const PATH = "/api/control/route-next";
const MODEL = "qwen3:1.7b";

const ALLOWED = {
  after_credit: ["fraud", "payment", "finish"],
  after_fraud: ["payment", "finish"],
} as const;

type Stage = keyof typeof ALLOWED;
type Choice = "fraud" | "payment" | "finish";

export async function POST(request: Request) {
  const unavailable = devOnly();
  if (unavailable) return unavailable;

  const signed = await readSignedJson(request, PATH);
  if (!signed.ok) return signed.response;

  const { address, body } = signed;

  const agent = registeredAgent(address);
  if (!agent || agent.role !== "credit") {
    return Response.json(
      { error: "Only enrolled credit agents can route tasks" },
      { status: 403 }
    );
  }

  const { userGoal, stage, previousDecision } = body;

  if (
    typeof userGoal !== "string" ||
    userGoal.length < 1 ||
    userGoal.length > 500 ||
    typeof stage !== "string" ||
    !(stage in ALLOWED) ||
    typeof previousDecision !== "string" ||
    previousDecision.length > 40
  ) {
    return Response.json(
      { error: "Invalid routing request" },
      { status: 400 }
    );
  }

  const validStage = stage as Stage;
  const choices: readonly string[] = ALLOWED[validStage];

 const instruction =
  validStage === "after_credit"
    ? `The credit report check is ALREADY complete.

Choose exactly one next action:

- finish: The user ONLY wanted a credit report,
  or explicitly says no other tasks are needed.
- fraud: The user explicitly requests fraud investigation.
- payment: The user explicitly requests a payment-agent task.

IMPORTANT:
If the user says "Only check the credit report"
or "No other tasks", you MUST choose finish.

If both fraud investigation and payment testing
are requested, choose fraud first.

Your next_agent MUST agree with your reason.`
    : `The fraud review is ALREADY complete.

Choose:
- payment: Only if a payment task remains.
- finish: If no further task remains.

If the user says finish after fraud,
you MUST choose finish.

Your next_agent MUST agree with your reason.`;

  const schema = {
    type: "object",
    properties: {
      next_agent: {
        type: "string",
        enum: choices,
      },
      reason: {
        type: "string",
      },
    },
    required: ["next_agent", "reason"],
    additionalProperties: false,
  };


  const prompt = `You are AgentCircuit's autonomous workflow planner.

Your job is to decide the NEXT unfinished task in a multi-step user request.

CURRENT STAGE: ${validStage}
LAST COMPLETED RESULT: ${previousDecision}

USER REQUEST:
"${userGoal}"

AVAILABLE ACTIONS:
${choices.join(", ")}

TASK DEFINITIONS:
fraud = investigate identity fraud or suspicious activity.
payment = test or perform an explicitly requested payment-agent task.
finish = all tasks requested by the user have been completed.

WORKFLOW RULES:
1. Check the ENTIRE user request, not only the last completed step.
2. A completed credit report does NOT mean a fraud investigation is complete.
3. A completed fraud review does NOT mean a requested payment test is complete.
4. If both fraud and payment are requested, do fraud first, then payment.
5. Select finish only when NO requested tasks remain.
6. Never select an action outside AVAILABLE ACTIONS.
7. You choose tasks, never permissions. AgentCircuit enforces authorization.

EXAMPLE 1:
Stage: after_credit
Request: Only check the credit report. No other work.
Answer: {"next_agent":"finish","reason":"No tasks remain."}

EXAMPLE 2:
Stage: after_credit
Request: First investigate identity fraud, then test payment-agent access.
Answer: {"next_agent":"fraud","reason":"Fraud investigation must happen before the requested payment test."}

EXAMPLE 3:
Stage: after_fraud
Request: First investigate identity fraud, then test payment-agent access.
Answer: {"next_agent":"payment","reason":"The fraud review is complete, and the payment test remains."}

EXAMPLE 4:
Stage: after_fraud
Request: Investigate identity fraud and finish after the review.
Answer: {"next_agent":"finish","reason":"Fraud review was the final requested task."}

${instruction}

Now decide the next unfinished task for the CURRENT user request.

Return JSON with:
- next_agent: one available action
- reason: the specific unfinished task, or why none remain.

Do not copy an example answer unless it matches the current request.`;


  try {
    const response = await fetch(
      "http://127.0.0.1:11434/api/generate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          format: schema,
          stream: false,
          think: false,
          options: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(90000),
      }
    );

    if (!response.ok) {
      return Response.json(
        { error: "Ollama request failed" },
        { status: 502 }
      );
    }

    const data = await response.json();
    const result = JSON.parse(data.response);

    const choice = result?.next_agent;
    if (!choices.includes(choice)) {
      return Response.json(
        { error: "AI returned an invalid route" },
        { status: 502 }
      );
    }

    const reason =
      typeof result.reason === "string"
        ? result.reason.slice(0, 300)
        : "No explanation provided";

    // The server made the Ollama call itself.
    // Agents cannot directly forge AI_DECISION events.
    logActivity({
      type: "AI_DECISION",
      agent: "credit",
      address,
      choice: choice as Choice,
      model: MODEL,
      detail: `${validStage}: ${choice}. ${reason}`,
    });

    return Response.json({
      next_agent: choice,
      reason,
      model: MODEL,
    });
  } catch {
    return Response.json(
      { error: "AI routing unavailable or invalid response" },
      { status: 502 }
    );
  }
}
