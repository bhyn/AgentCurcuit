
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents import Agent, Bureau, Context, Model

# AgentCircuit connection
ROOT = Path(__file__).resolve().parent.parent
TOKEN = dotenv_values(ROOT / ".env.local").get(
    "AGENTCIRCUIT_AGENT_TOKEN"
)
API = "http://127.0.0.1:3000/api/control/agent-request"

# Fetch.ai message types
class WorkOrder(Model):
    persona_id: str
    bureau: str
    task: str


class WorkResult(Model):
    role: str
    decision: str
    success: bool


# Three independent Fetch.ai uAgents
credit = Agent(name="coordinated_credit")
fraud = Agent(name="coordinated_fraud")
payment = Agent(name="coordinated_payment")


# All sensitive API actions go through AgentCircuit.
async def request_control(ctx, role, order):
    if not TOKEN:
        raise RuntimeError("AgentCircuit token missing")

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            API,
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={
                "agent": role,
                "personaId": order.persona_id,
                "bureau": order.bureau,
            },
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"AgentCircuit HTTP {response.status_code}"
        )

    result = response.json()
    ctx.logger.info(
        f"AGENTCIRCUIT | {role.upper()} "
        f"| {result.get('decision')} "
        f"| success={result.get('success', 'N/A')}"
    )
    return result


# 1. Credit Agent starts the workflow.
@credit.on_event("startup")
async def credit_start(ctx: Context):
    order = WorkOrder(
        persona_id="P01",
        bureau="transunion",
        task="check_credit",
    )

    try:
        result = await request_control(ctx, "credit", order)

        if (
            result.get("decision") not in ("ALLOW", "REUSE")
            or result.get("success") is not True
        ):
            ctx.logger.error("Credit check failed. Stopping.")
            return

        next_order = WorkOrder(
            persona_id="P01",
            bureau="transunion",
            task="review_fraud",
        )

        ctx.logger.info("MESSAGE | Credit -> Fraud")
        await ctx.send(fraud.address, next_order)

    except Exception as error:
        ctx.logger.error(f"Credit error: {error}")


# 2. Fraud Agent receives a real uAgents message.
@fraud.on_message(model=WorkOrder)
async def fraud_receive(
    ctx: Context, sender: str, msg: WorkOrder
):
    if sender != credit.address:
        ctx.logger.warning("Rejected unknown sender")
        return

    ctx.logger.info(
        f"MESSAGE RECEIVED | Credit -> Fraud | {msg.task}"
    )

    try:
        result = await request_control(ctx, "fraud", msg)

        reply = WorkResult(
            role="fraud",
            decision=result.get("decision", "ERROR"),
            success=result.get("success") is True,
        )

        ctx.logger.info("MESSAGE | Fraud -> Credit")
        await ctx.send(sender, reply)

    except Exception as error:
        ctx.logger.error(f"Fraud error: {error}")


# 3. Credit Agent receives Fraud's answer,
# then delegates another task to Payment.
@credit.on_message(model=WorkResult)
async def credit_receive(
    ctx: Context, sender: str, msg: WorkResult
):
    if sender == fraud.address:
        ctx.logger.info(
            f"MESSAGE RECEIVED | Fraud -> Credit "
            f"| {msg.decision}"
        )

        if not msg.success:
            ctx.logger.error("Fraud step failed. Stopping.")
            return

        order = WorkOrder(
            persona_id="P01",
            bureau="transunion",
            task="payment_credit_access",
        )

        ctx.logger.info("MESSAGE | Credit -> Payment")
        await ctx.send(payment.address, order)

    elif sender == payment.address:
        ctx.logger.info(
            f"MESSAGE RECEIVED | Payment -> Credit "
            f"| {msg.decision}"
        )

        if msg.decision == "BLOCK":
            ctx.logger.info(
                "WORKFLOW COMPLETE: Unauthorized access blocked!"
            )
        else:
            ctx.logger.warning(
                f"Unexpected payment decision: {msg.decision}"
            )


# 4. Payment receives a message, but its
# attempted credit access must pass AgentCircuit.
@payment.on_message(model=WorkOrder)
async def payment_receive(
    ctx: Context, sender: str, msg: WorkOrder
):
    if sender != credit.address:
        ctx.logger.warning("Rejected unknown sender")
        return

    ctx.logger.info(
        f"MESSAGE RECEIVED | Credit -> Payment | {msg.task}"
    )

    try:
        result = await request_control(ctx, "payment", msg)

        reply = WorkResult(
            role="payment",
            decision=result.get("decision", "ERROR"),
            success=result.get("success") is True,
        )

        ctx.logger.info("MESSAGE | Payment -> Credit")
        await ctx.send(sender, reply)

    except Exception as error:
        ctx.logger.error(f"Payment error: {error}")


# Fetch.ai Bureau runs all three agents.
if __name__ == "__main__":
    bureau = Bureau(
        agents=[credit, fraud, payment],
        port=8077,
    )
    bureau.run()
