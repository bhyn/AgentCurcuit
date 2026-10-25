

import hashlib
import json
import secrets
import time
from pathlib import Path

import httpx
from ollama_router import decide_action
from dotenv import dotenv_values
from uagents import Agent, Context, Protocol
from uagents_core.identity import Identity
from uagents_core.contrib.protocols.chat import (
    ChatMessage,
    ChatAcknowledgement,
    TextContent,
    EndSessionContent,
    chat_protocol_spec,
)

ROOT = Path(__file__).resolve().parent.parent
config = dotenv_values(ROOT / ".env.local")

SEED = config.get("AGENT_SEED_PHRASE")

if not SEED:
    raise SystemExit("AGENT_SEED_PHRASE is missing")

identity = Identity.from_seed(SEED, 0)

agent = Agent(
    name="agentcircuit_gateway",
    seed=SEED,
    port=8085,
    mailbox=True,
    publish_agent_details=True,
)

# The running Agentverse gateway must use the same
# identity that was enrolled in AgentCircuit.
if agent.address.lower() != identity.address.lower():
    raise SystemExit(
        "Identity mismatch: Gateway and signed client "
        "have different addresses"
    )

chat = Protocol(spec=chat_protocol_spec)

API_URL = (
    "http://127.0.0.1:3000"
    "/api/control/agent-request"
)
PATH = "/api/control/agent-request"


async def send_signed_request(persona_id: str, bureau: str):
    body = {
        "personaId": persona_id,
        "bureau": bureau,
        "claimedRole": "payment",
    }

    raw = json.dumps(
        body,
        separators=(",", ":"),
        ensure_ascii=False,
    )

    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(16)

    body_hash = hashlib.sha256(
        raw.encode("utf-8")
    ).hexdigest()

    canonical = "\n".join([
        "AGENTCIRCUIT-V1",
        "POST",
        PATH,
        timestamp,
        nonce,
        body_hash,
    ])

    digest = hashlib.sha256(
        canonical.encode("utf-8")
    ).digest()

    signature = identity.sign_digest(digest)

    headers = {
        "Content-Type": "application/json",
        "X-Agent-Address": identity.address,
        "X-Agent-Timestamp": timestamp,
        "X-Agent-Nonce": nonce,
        "X-Agent-Signature": signature,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            API_URL,
            headers=headers,
            content=raw.encode("utf-8"),
        )

    try:
        data = response.json()
    except ValueError:
        data = {}

    return response.status_code, data


@chat.on_message(ChatMessage)
async def handle_chat(
    ctx: Context,
    sender: str,
    msg: ChatMessage,
):
    await ctx.send(
        sender,
        ChatAcknowledgement(
            acknowledged_msg_id=msg.msg_id
        ),
    )

    message = " ".join(
        item.text
        for item in msg.content
        if isinstance(item, TextContent)
    ).strip().lower()

    ctx.logger.info("Agentverse message received")

    if message.endswith("status"):
        answer = (
            "AgentCircuit Gateway is online. "
            "Available command: test block."
        )

    elif message.endswith("test block"):
        try:
            status, result = await send_signed_request("P01", "transunion")

            if status == 200:
                decision = result.get(
                    "decision", "UNKNOWN"
                )
                reason = result.get(
                    "reason", "unknown"
                )
                answer = (
                    f"AgentCircuit decision: {decision}. "
                    f"Reason: {reason}."
                )
            else:
                error = (
                    result.get("error")
                    or result.get("detail")
                    or result.get("reason")
                    or "unknown error"
                )
                answer = (
                    f"AgentCircuit HTTP {status}: "
                    f"{error}"
                )

        except Exception as error:
            ctx.logger.error(
                "AgentCircuit request failed: %s",
                type(error).__name__,
            )
            answer = (
                "AgentCircuit connection failed: "
                f"{type(error).__name__}"
            )

    
    else:
        try:
            decision = await decide_action(message)

            action = decision["action"]
            reason = decision["reason"]

            ctx.logger.info(
                "OLLAMA AI DECISION: %s",
                action
            )

            ctx.logger.info(
                "OLLAMA AI REASON: %s",
                reason
            )

            if action == "request_credit_report":
                status, result = await send_signed_request(
                    decision["personaId"],
                    decision["bureau"],
                )

                if status == 200:
                    answer = (
                        f"AI decision: {action}. "
                        f"AI reason: {reason}. "
                        "AgentCircuit decision: "
                        f"{result.get('decision', 'UNKNOWN')}. "
                        "Reason: "
                        f"{result.get('reason', 'unknown')}."
                    )
                else:
                    error = (
                        result.get("error")
                        or result.get("detail")
                        or "unknown"
                    )
                    answer = (
                        f"AI decision: {action}. "
                        f"AgentCircuit HTTP {status}: {error}"
                    )

            else:
                answer = (
                    "AI decision: reply_only. "
                    + decision["reply"]
                )

        except Exception as error:
            ctx.logger.error(
                "Ollama error: %s",
                type(error).__name__
            )
            answer = (
                "AI decision unavailable: "
                f"{type(error).__name__}. "
                "No credit report request was sent."
            )


    ctx.logger.info("Agentverse response sent")

    await ctx.send(
        sender,
        ChatMessage(
            content=[
                TextContent(
                    type="text",
                    text=answer,
                ),
                EndSessionContent(
                    type="end-session"
                ),
            ]
        ),
    )
@chat.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass

agent.include(chat, publish_manifest=True)

if __name__ == "__main__":
    agent.run()

