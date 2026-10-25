
import json
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents import Agent, Bureau, Context, Model

ROOT = Path(__file__).resolve().parent.parent
TOKEN = dotenv_values(ROOT / ".env.local").get(
    "AGENTCIRCUIT_AGENT_TOKEN"
)

CONTROL_API = "http://127.0.0.1:3000/api/control/agent-request"
OLLAMA_API = "http://127.0.0.1:11434/api/generate"

SCENARIOS = {
    "routine": (
        "A routine credit check succeeded. "
        "No unusual changes or discrepancies."
    ),
    "suspicious": (
        "A credit check succeeded. The customer "
        "suddenly changed their address and device. "
        "These changes have not been verified."
    ),
    "payment": (
        "A payment agent requests direct access "
        "to a customer's credit report."
    ),
}

scenario = sys.argv[1] if len(sys.argv) > 1 else "suspicious"

if scenario not in SCENARIOS:
    raise SystemExit("Use: routine, suspicious, payment")

if not TOKEN:
    raise SystemExit("AgentCircuit token missing")


class WorkOrder(Model):
    persona_id: str
    bureau: str


class WorkResult(Model):
    role: str
    decision: str


credit = Agent(name="ollama_credit_agent")
fraud = Agent(name="ollama_fraud_agent")
payment = Agent(name="ollama_payment_agent")


async def request_control(ctx, role):
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            CONTROL_API,
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


async def ai_decide(ctx):
    prompt = (
        "You are an AI workflow coordinator. "
        "Select the NEXT AGENT based on the situation.\n"
        "Choose fraud for suspicious identity changes "
        "requiring verification.\n"
        "Choose payment when a payment agent requests "
        "access and authorization must be checked.\n"
        "Choose finish when no more work is needed.\n"
        "Return JSON with next_agent and reason.\n\n"
        f"Situation: {SCENARIOS[scenario]}"
    )

    schema = {
        "type": "object",
        "properties": {
            "next_agent": {
                "type": "string",
                "enum": ["fraud", "payment", "finish"]
            },
            "reason": {"type": "string"}
        },
        "required": ["next_agent", "reason"]
    }

    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(
            OLLAMA_API,
            json={
                "model": "qwen3:0.6b",
                "prompt": prompt,
                "format": schema,
                "stream": False,
                "think": False,
                "options": {
                    "temperature": 0,
                    "num_ctx": 1024,
                    "num_predict": 120
                },
                "keep_alive": 0
            }
        )

    response.raise_for_status()
    decision = json.loads(
        response.json()["response"]
    )

    selected = decision["next_agent"]
    if selected not in ("fraud", "payment", "finish"):
        raise ValueError("Invalid AI decision")

    ctx.logger.info(f"OLLAMA AI DECISION: {selected}")
    ctx.logger.info(
        f"OLLAMA AI REASON: {decision['reason']}"
    )

    return selected


@credit.on_event("startup")
async def credit_start(ctx: Context):
    ctx.logger.info(f"SCENARIO: {scenario}")

    try:
        result = await request_control(ctx, "credit")

        if result.get("success") is not True:
            ctx.logger.error("Credit API failed.")
            return

        selected = await ai_decide(ctx)

        # Safety policy is separate from the AI decision.
        if scenario == "suspicious" and selected != "fraud":
            ctx.logger.warning(
                f"SAFETY OVERRIDE: {selected} -> fraud"
            )
            selected = "fraud"

        if selected == "finish":
            ctx.logger.info("WORKFLOW COMPLETE")
            return

        target = fraud if selected == "fraud" else payment

        ctx.logger.info(
            f"FETCH MESSAGE | Credit -> {selected}"
        )

        await ctx.send(
            target.address,
            WorkOrder(
                persona_id="P01",
                bureau="transunion"
            )
        )

    except Exception as error:
        ctx.logger.error(f"Workflow error: {error}")


@fraud.on_message(model=WorkOrder)
async def fraud_work(ctx: Context, sender: str, msg: WorkOrder):
    if sender != credit.address:
        return

    ctx.logger.info("FETCH MESSAGE RECEIVED | Fraud")

    try:
        result = await request_control(ctx, "fraud")
        await ctx.send(
            sender,
            WorkResult(
                role="fraud",
                decision=result.get("decision", "ERROR")
            )
        )
    except Exception as error:
        ctx.logger.error(f"Fraud error: {error}")


@payment.on_message(model=WorkOrder)
async def payment_work(ctx: Context, sender: str, msg: WorkOrder):
    if sender != credit.address:
        return

    ctx.logger.info("FETCH MESSAGE RECEIVED | Payment")

    try:
        result = await request_control(ctx, "payment")
        await ctx.send(
            sender,
            WorkResult(
                role="payment",
                decision=result.get("decision", "ERROR")
            )
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
        f"FETCH RESULT | {msg.role} | {msg.decision}"
    )
    ctx.logger.info("WORKFLOW COMPLETE")


if __name__ == "__main__":
    bureau = Bureau(
        agents=[credit, fraud, payment],
        port=8079
    )
    bureau.run()
