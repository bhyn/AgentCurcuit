
import asyncio
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents import Agent, Bureau, Context

ROOT = Path(__file__).resolve().parent.parent
TOKEN = dotenv_values(ROOT / ".env.local").get(
    "AGENTCIRCUIT_AGENT_TOKEN"
)

API = "http://127.0.0.1:3000/api/control/agent-request"

credit_finished = asyncio.Event()

credit = Agent(name="fetch_credit_agent")
fraud = Agent(name="fetch_fraud_agent")
payment = Agent(name="fetch_payment_agent")


async def send_request(ctx: Context, role: str):
    if not TOKEN:
        ctx.logger.error("AgentCircuit token missing")
        return

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                API,
                headers={"Authorization": f"Bearer {TOKEN}"},
                json={
                    "agent": role,
                    "personaId": "P01",
                    "bureau": "transunion",
                },
            )

        result = response.json()

        ctx.logger.info(
            f"{role.upper()} | HTTP {response.status_code} "
            f"| Decision: {result.get('decision')} "
            f"| Success: {result.get('success', 'N/A')} "
            f"| Reason: {result.get('reason', 'N/A')}"
        )

    except Exception as error:
        ctx.logger.error(f"{role}: {error}")


@credit.on_event("startup")
async def start_credit(ctx: Context):
    try:
        await send_request(ctx, "credit")
    finally:
        credit_finished.set()


@fraud.on_event("startup")
async def start_fraud(ctx: Context):
    # Wait for Credit Agent so result reuse is predictable.
    await credit_finished.wait()
    await send_request(ctx, "fraud")


@payment.on_event("startup")
async def start_payment(ctx: Context):
    await send_request(ctx, "payment")


if __name__ == "__main__":
    bureau = Bureau(
        agents=[credit, fraud, payment],
        port=8076,
    )
    bureau.run()
