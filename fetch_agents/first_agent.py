
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents import Agent, Context

# Read the existing AgentCircuit token.
root = Path(__file__).resolve().parent.parent
config = dotenv_values(root / ".env.local")
token = config.get("AGENTCIRCUIT_AGENT_TOKEN")

agent = Agent(
    name="agentcircuit_fetch_demo",
    port=8075,
    endpoint=["http://127.0.0.1:8075/submit"],
)

@agent.on_event("startup")
async def startup(ctx: Context):
    ctx.logger.info("Fetch.ai Agent started!")

    if not token:
        ctx.logger.error("AgentCircuit token missing")
        return

    # Intentionally test an unauthorized request.
    payload = {
        "agent": "payment",
        "personaId": "P01",
        "bureau": "transunion",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "http://127.0.0.1:3000/api/control/agent-request",
                headers={
                    "Authorization": f"Bearer {token}"
                },
                json=payload,
            )

        result = response.json()

        ctx.logger.info(f"HTTP: {response.status_code}")
        ctx.logger.info(f"Decision: {result.get('decision')}")
        ctx.logger.info(f"Reason: {result.get('reason')}")

    except Exception as error:
        ctx.logger.error(f"Connection error: {error}")

if __name__ == "__main__":
    agent.run()
