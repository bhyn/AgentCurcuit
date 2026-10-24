"""AgentCircuit lead agent.

ASI:One chat -> (Agent Chat Protocol) -> this agent -> CreditRequest -> credit sub-agent
-> CreditResult -> this agent -> chat reply. Requests and results are matched by task_id.
"""

import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

load_dotenv()

import report  # noqa: E402
from common import PERSONAS, CreditRequest, CreditResult  # noqa: E402


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not set. Run `python init_env.py` or see .env.example.")
    return value


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


PORT = int(os.getenv("LEAD_PORT", "8001"))
CREDIT_ADDRESS = _require("CREDIT_AGENT_ADDRESS")
TASK_TIMEOUT_S = float(os.getenv("LEAD_TASK_TIMEOUT_S", "45"))
USE_MAILBOX = _flag("LEAD_MAILBOX", "true")

if USE_MAILBOX:
    # Local agent + Mailbox: Agentverse relays ASI:One messages to this process.
    agent = Agent(
        name="AgentCircuit",
        seed=_require("LEAD_AGENT_SEED"),
        port=PORT,
        mailbox=True,
        publish_agent_details=True,
        readme_path=os.path.join(os.path.dirname(__file__), "README.md"),
        handle_messages_concurrently=True,
    )
else:
    # Local-only mode for tests: direct HTTP endpoint, nothing published to Agentverse.
    agent = Agent(
        name="AgentCircuit",
        seed=_require("LEAD_AGENT_SEED"),
        port=PORT,
        endpoint=[f"http://127.0.0.1:{PORT}/submit"],
        handle_messages_concurrently=True,
    )

chat = Protocol(spec=chat_protocol_spec)


@dataclass
class Pending:
    user: str  # chat address that asked (ASI:One or a test client)
    persona_id: str
    created: float


# task_id -> who is waiting. In-memory: a restart drops open tasks, which then simply time out upstream.
PENDING: Dict[str, Pending] = {}


async def say(ctx: Context, to: str, text: str):
    await ctx.send(
        to,
        ChatMessage(
            timestamp=datetime.now(timezone.utc),
            msg_id=uuid.uuid4(),
            content=[TextContent(type="text", text=text), EndSessionContent(type="end-session")],
        ),
    )


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    # ACP: acknowledge every incoming ChatMessage first.
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))

    text = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
    requested = report.extract_personas(text)

    if not requested:
        await say(ctx, sender, report.help_text())
        return
    if len(requested) > 1 or requested[0] not in PERSONAS:
        await say(ctx, sender, report.not_allowed_text(requested))
        return

    persona_id = requested[0]
    task_id = uuid.uuid4().hex[:12]
    PENDING[task_id] = Pending(user=sender, persona_id=persona_id, created=time.monotonic())
    ctx.logger.info(f"[{task_id}] chat from {sender}: delegating {persona_id} to credit agent")

    status = await ctx.send(CREDIT_ADDRESS, CreditRequest(task_id=task_id, persona_id=persona_id))
    if str(getattr(status.status, "value", status.status)) == "failed":
        PENDING.pop(task_id, None)
        ctx.logger.error(f"[{task_id}] could not deliver to credit agent: {status.detail}")
        await say(ctx, sender, report.unavailable_text(persona_id, task_id, "the Credit agent is not reachable."))


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info(f"ack from {sender} for {msg.acknowledged_msg_id}")


agent.include(chat, publish_manifest=True)


@agent.on_message(model=CreditResult)
async def on_credit_result(ctx: Context, sender: str, msg: CreditResult):
    if sender != CREDIT_ADDRESS:
        ctx.logger.warning(f"Ignoring CreditResult {msg.task_id} from unexpected sender {sender}")
        return
    pending = PENDING.pop(msg.task_id, None)
    if pending is None:
        # Either already timed out or never ours. Do not message anyone.
        ctx.logger.warning(f"[{msg.task_id}] result for unknown or expired task, dropped")
        return
    if msg.persona_id != pending.persona_id:
        ctx.logger.error(f"[{msg.task_id}] persona mismatch: asked {pending.persona_id}, got {msg.persona_id}")
        await say(ctx, pending.user, report.unavailable_text(pending.persona_id, msg.task_id, "the Credit agent answered for a different persona."))
        return

    ctx.logger.info(f"[{msg.task_id}] result {msg.status}: {[(b.bureau, b.outcome) for b in msg.bureaus]}")
    if msg.status != "completed":
        await say(ctx, pending.user, report.unavailable_text(pending.persona_id, msg.task_id, msg.error or "the lookup was refused."))
        return
    await say(ctx, pending.user, report.render_report(msg.persona_id, msg.task_id, msg.bureaus))


@agent.on_interval(period=1.0)
async def expire_tasks(ctx: Context):
    now = time.monotonic()
    for task_id, p in list(PENDING.items()):
        if now - p.created > TASK_TIMEOUT_S:
            PENDING.pop(task_id, None)
            ctx.logger.warning(f"[{task_id}] timed out after {TASK_TIMEOUT_S:g}s")
            await say(ctx, p.user, report.timeout_text(p.persona_id, task_id, TASK_TIMEOUT_S))


@agent.on_event("startup")
async def announce(ctx: Context):
    mode = "mailbox" if USE_MAILBOX else "local-only"
    ctx.logger.info(f"AgentCircuit lead ready ({mode}). address={agent.address} credit={CREDIT_ADDRESS}")


if __name__ == "__main__":
    agent.run()
