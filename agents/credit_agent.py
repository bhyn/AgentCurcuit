"""Credit sub-agent: looks up a sandbox persona at the three bureaus and reports back.

It holds no CRS credentials. It asks the Next.js gateway, which owns them.
"""

import asyncio
import os

import httpx
from dotenv import load_dotenv
from uagents import Agent, Context

load_dotenv()

from common import BUREAUS, PERSONAS, CreditRequest, CreditResult  # noqa: E402
from gateway import fetch_bureau  # noqa: E402


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not set. Run `python init_env.py` or see .env.example.")
    return value


PORT = int(os.getenv("CREDIT_PORT", "8002"))
LEAD_ADDRESS = _require("LEAD_AGENT_ADDRESS")

agent = Agent(
    name="agentcircuit-credit",
    seed=_require("CREDIT_AGENT_SEED"),
    port=PORT,
    endpoint=[f"http://127.0.0.1:{PORT}/submit"],
    handle_messages_concurrently=True,
)


@agent.on_event("startup")
async def announce(ctx: Context):
    ctx.logger.info(f"Credit agent ready. address={agent.address} accepts requests only from {LEAD_ADDRESS}")


@agent.on_message(model=CreditRequest)
async def handle_request(ctx: Context, sender: str, msg: CreditRequest):
    if sender != LEAD_ADDRESS:
        ctx.logger.warning(f"Ignoring CreditRequest {msg.task_id} from unexpected sender {sender}")
        return

    if msg.persona_id not in PERSONAS:
        ctx.logger.warning(f"[{msg.task_id}] rejected: persona {msg.persona_id!r} is not allowed")
        await ctx.send(
            sender,
            CreditResult(
                task_id=msg.task_id,
                persona_id=msg.persona_id,
                status="rejected",
                error=f"{msg.persona_id!r} is not an allowed sandbox persona",
            ),
        )
        return

    ctx.logger.info(f"[{msg.task_id}] pulling {msg.persona_id} from {len(BUREAUS)} bureaus")
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(fetch_bureau(client, msg.persona_id, b) for b in BUREAUS))

    for r in results:
        ctx.logger.info(
            f"[{msg.task_id}] {r.bureau}: {r.outcome} score={r.score} requestId={r.request_id} {r.duration_ms}ms"
        )
    await ctx.send(
        sender,
        CreditResult(task_id=msg.task_id, persona_id=msg.persona_id, status="completed", bureaus=list(results)),
    )


if __name__ == "__main__":
    agent.run()
