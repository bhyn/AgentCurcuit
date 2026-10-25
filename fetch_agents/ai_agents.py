
import json
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values
from openai import AsyncOpenAI
from uagents import Agent, Bureau, Context, Model

ROOT = Path(__file__).resolve().parent.parent
config = dotenv_values(ROOT / ".env.local")

TOKEN = config.get("AGENTCIRCUIT_AGENT_TOKEN")
AI_KEY = config.get("OPENAI_API_KEY")
API = "http://127.0.0.1:3000/api/control/agent-request"

# Synthetic test situations, not real customer findings.
SCENARIOS = {
    "routine": (
        "Credit check succeeded. No unusual account "
        "changes or identity discrepancies were reported. "
        "The routine check is complete."
    ),
    "suspicious": (
        "Credit check succeeded. The customer's contact "
        "address changed today, and the device identifier "
        "differs from previous applications. Additional "
        "identity-fraud review may be needed."
    ),
    "payment": (
        "Credit check succeeded. A payment-processing "
        "agent is requesting direct access to the "
        "customer's credit report. Route the attempted "
        "access through the authorization system."
    ),
}

scenario = sys.argv[1] if len(sys.argv) > 1 else "suspicious"

if scenario not in SCENARIOS:
    raise SystemExit(
        "Choose: routine, suspicious, or payment"
    )

if not TOKEN or not AI_KEY:
    raise SystemExit(
        "Missing AGENTCIRCUIT_AGENT_TOKEN or OPENAI_API_KEY"
    )

client = AsyncOpenAI(
    api_key=AI_KEY,
    timeout=30.0,
    max_retries=0,
)


class WorkOrder(Model):
    persona_id: str
    bureau: str
    task: str


class WorkResult(Model):
    role: str
    decision: str
    success: bool


credit = Agent(name="ai_credit_agent")
fraud = Agent(name="ai_fraud_agent")
payment = Agent(name="ai_payment_agent")


async def request_control(ctx: Context, role: str):
    async with httpx.AsyncClient(timeout=60) as http:
        response = await http.post(
            API,
            headers={
                "Authorization": f"Bearer {TOKEN}"
            },
            json={
                "agent": role,
                "personaId": "P01",
                "bureau": "transunion",
            },
        )

    response.raise_for_status()
    result = response.json()

    ctx.logger.info(
        f"AGENTCIRCUIT | {role.upper()} "
        f"| {result.get('decision')} "
        f"| success={result.get('success', 'N/A')}"
    )
    return result


# Actual LLM-based decision, not a fixed workflow order.
async def decide_next_action(ctx: Context):
    response = await client.responses.create(
        model="gpt-4o-mini",
        instructions=(
            "You coordinate a synthetic finance agent demo. "
            "Choose the next agent based on the provided "
            "situation. Choose 'fraud' when an identity or "
            "device anomaly needs investigation. Choose "
            "'payment' when a payment agent explicitly "
            "requests credit-report access, so the "
            "authorization system can evaluate that request. "
            "Choose 'finish' if no further action is needed. "
            "You do not grant permissions. AgentCircuit "
            "enforces all permissions and budgets. "
            "Do not invent credit scores or fraud findings."
        ),
        input=SCENARIOS[scenario],
        text={
            "format": {
                "type": "json_schema",
                "name": "next_agent_decision",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "next_agent": {
                            "type": "string",
                            "enum": [
                                "fraud",
                                "payment",
                                "finish",
                            ],
                        },
                        "reason": {
                            "type": "string"
                        },
                    },
                    "required": [
                        "next_agent",
                        "reason",
                    ],
                    "additionalProperties": False,
                },
            }
        },
    )

    decision = json.loads(response.output_text)

    ctx.logger.info(
        f"AI MODEL RESPONSE ID: {response.id}"
    )
    ctx.logger.info(
        f"AI DECISION: {decision['next_agent']}"
    )
    ctx.logger.info(
        f"AI REASON: {decision['reason']}"
    )

    return decision["next_agent"]


@credit.on_event("startup")
async def start_credit(ctx: Context):
    ctx.logger.info(f"SCENARIO: {scenario}")

    try:
        result = await request_control(ctx, "credit")

        if result.get("success") is not True:
            ctx.logger.error(
                "Credit lookup failed. Workflow stopped."
            )
            return

        next_agent = await decide_next_action(ctx)

        if next_agent == "fraud":
            ctx.logger.info("MESSAGE | Credit -> Fraud")
            await ctx.send(
                fraud.address,
                WorkOrder(
                    persona_id="P01",
                    bureau="transunion",
                    task="review_fraud",
                ),
            )

        elif next_agent == "payment":
            ctx.logger.info("MESSAGE | Credit -> Payment")
            await ctx.send(
                payment.address,
                WorkOrder(
                    persona_id="P01",
                    bureau="transunion",
                    task="request_credit_access",
                ),
            )

        else:
            ctx.logger.info(
                "AI WORKFLOW COMPLETE: No further action."
            )

    except Exception as error:
        ctx.logger.error(f"Workflow error: {error}")


@fraud.on_message(model=WorkOrder)
async def handle_fraud(
    ctx: Context, sender: str, msg: WorkOrder
):
    if sender != credit.address:
        return

    ctx.logger.info(
        "MESSAGE RECEIVED | Credit -> Fraud"
    )

    try:
        result = await request_control(ctx, "fraud")

        await ctx.send(
            sender,
            WorkResult(
                role="fraud",
                decision=result.get("decision", "ERROR"),
                success=result.get("success") is True,
            ),
        )
    except Exception as error:
        ctx.logger.error(f"Fraud error: {error}")


@payment.on_message(model=WorkOrder)
async def handle_payment(
    ctx: Context, sender: str, msg: WorkOrder
):
    if sender != credit.address:
        return

    ctx.logger.info(
        "MESSAGE RECEIVED | Credit -> Payment"
    )

    try:
        result = await request_control(ctx, "payment")

        await ctx.send(
            sender,
            WorkResult(
                role="payment",
                decision=result.get("decision", "ERROR"),
                success=result.get("success") is True,
            ),
        )
    except Exception as error:
        ctx.logger.error(f"Payment error: {error}")


@credit.on_message(model=WorkResult)
async def receive_result(
    ctx: Context, sender: str, msg: WorkResult
):
    if sender not in (fraud.address, payment.address):
        return

    ctx.logger.info(
        f"MESSAGE RECEIVED | {msg.role.upper()} "
        f"-> CREDIT | {msg.decision}"
    )
    ctx.logger.info(
        f"AI WORKFLOW COMPLETE | "
        f"{msg.role}: {msg.decision}"
    )


if __name__ == "__main__":
    bureau = Bureau(
        agents=[credit, fraud, payment],
        port=8078,
    )
    bureau.run()
