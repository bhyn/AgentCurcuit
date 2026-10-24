"""Stand-in for ASI:One chat, for local verification.

Sends one ChatMessage to the lead agent over the Agent Chat Protocol, prints the
acknowledgement and the reply, then exits.

    python dev_client.py "Check credit for P17"
"""

import os
import sys
import time

from dotenv import load_dotenv
from uagents import Agent, Context
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
)

load_dotenv()

LEAD_ADDRESS = os.getenv("LEAD_AGENT_ADDRESS", "")
QUESTION = " ".join(sys.argv[1:]) or "Check credit for P01"
WAIT_S = float(os.getenv("DEV_CLIENT_WAIT_S", "60"))
PORT = int(os.getenv("DEV_CLIENT_PORT", "8003"))

# Not a secret: this client has no privileges. It only needs a stable identity.
agent = Agent(
    name="agentcircuit-dev-client",
    seed="agentcircuit-dev-client-not-a-secret",
    port=PORT,
    endpoint=[f"http://127.0.0.1:{PORT}/submit"],
)
started = time.monotonic()


def out(text: str = ""):
    # os._exit() below skips buffer flushing, so flush every line.
    print(text, flush=True)


@agent.on_event("startup")
async def ask(ctx: Context):
    if not LEAD_ADDRESS.startswith("agent1"):
        out("LEAD_AGENT_ADDRESS is not set. Run `python init_env.py` first.")
        os._exit(2)
    out(f"> {QUESTION}")
    await ctx.send(LEAD_ADDRESS, ChatMessage(content=[TextContent(type="text", text=QUESTION)]))


@agent.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    out(f"[ack received for {msg.acknowledged_msg_id}]")


@agent.on_message(ChatMessage)
async def on_reply(ctx: Context, sender: str, msg: ChatMessage):
    for item in msg.content:
        if isinstance(item, TextContent):
            out("\n" + item.text + "\n")
    out(f"[reply received after {time.monotonic() - started:.1f}s]")
    os._exit(0)


@agent.on_interval(period=1.0)
async def give_up(ctx: Context):
    if time.monotonic() - started > WAIT_S:
        out(f"[no reply within {WAIT_S:g}s]")
        os._exit(1)


if __name__ == "__main__":
    agent.run()
