"""AgentCircuit underwriting gateway for Agentverse and ASI:One.

A mailbox uAgent that speaks the Fetch.ai chat protocol, so ASI:One (or any agent on
Agentverse) can ask it to underwrite a CRS sandbox persona. The gateway acts as an
enrolled credit agent: it pulls the three bureaus through AgentCircuit with signed
requests, asks the local Ollama model for a proposal, and replies with AgentCircuit's
final policy decision.

Usage (Next.js dev server on port 3000 and Ollama running locally):
    python fetch_agents/asi_gateway_agent.py
Open the Agent Inspector link printed at startup and connect the mailbox once.

Development-only demo on CRS sandbox personas. Replies carry summaries only, never
credit-report contents or credentials.
"""
import asyncio
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from agentcircuit_client import (
    BUREAU_LABELS,
    BUREAUS,
    ROOT,
    AgentCircuit,
    AgentCircuitError,
    OllamaError,
    clip,
    facts_text,
    ollama_json,
)

PERSONAS = {
    "P01": "Margaret Okafor (prime)",
    "P13": "Kayla Brennan (synthetic identity)",
    "P14": "Harold Pettigrew (deceased indicator)",
    "P15": "Nicole Farragut (TransUnion freeze)",
    "P17": "Elena Castellanos (bureau divergence)",
}
RECOMMENDATIONS = ("APPROVE", "REVIEW", "DECLINE")
CREDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "recommendation": {"type": "string", "enum": list(RECOMMENDATIONS)},
        "reason": {"type": "string"},
    },
    "required": ["recommendation", "reason"],
}
HELP = (
    "I am the AgentCircuit underwriting gateway for CRS sandbox personas (fake applicants). "
    "Ask me to check one of: "
    + ", ".join(f"{pid} {name}" for pid, name in PERSONAS.items())
    + '. Example: "Underwrite applicant P13".'
)

# uagents keeps agent keys in ./private_keys.json; pin it to the project root.
os.chdir(ROOT)

gateway = Agent(
    name="agentcircuit_asi_gateway",
    port=8090,
    mailbox=True,
    readme_path=str(ROOT / "fetch_agents" / "asi_gateway_README.md"),
    publish_agent_details=True,
)
circuit = AgentCircuit(gateway, "credit")
chat = Protocol(spec=chat_protocol_spec)
lock = asyncio.Lock()


def credit_prompt(facts: str) -> str:
    return (
        "You are a credit underwriting assistant reviewing a synthetic test applicant.\n"
        "Choose one recommendation using only the credit bureau facts below.\n"
        "- APPROVE: the facts support extending credit.\n"
        "- REVIEW: a human underwriter should check the file before deciding.\n"
        "- DECLINE: the facts show that credit should not be extended.\n"
        "Weigh the credit scores, whether each bureau returned a file, any bureau errors, "
        "and whether the bureaus agree.\n\n"
        f"Bureau facts:\n{facts}\n\n"
        'Answer in JSON: {"recommendation": "APPROVE" | "REVIEW" | "DECLINE", '
        '"reason": "<one sentence citing the facts>"}'
    )


def reply(text: str) -> ChatMessage:
    return ChatMessage(
        timestamp=datetime.now(timezone.utc),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=text), EndSessionContent(type="end-session")],
    )


async def underwrite(ctx: Context, persona_id: str) -> str:
    async def pull(bureau: str) -> dict:
        try:
            return await circuit.credit_report(persona_id, bureau)
        except AgentCircuitError as exc:
            return {"decision": "ERROR", "detail": str(exc)}

    pulls = dict(zip(BUREAUS, await asyncio.gather(*(pull(b) for b in BUREAUS))))
    access = [
        f"{BUREAU_LABELS[b]} {r.get('decision')}" + (f" ({r['reason']})" if r.get("reason") else "")
        for b, r in pulls.items()
    ]
    if all(r.get("decision") == "ERROR" for r in pulls.values()):
        return f"AgentCircuit is unreachable: {pulls['transunion'].get('detail')}"

    proposal, model = None, None
    try:
        answer, model = await ollama_json(credit_prompt(facts_text(pulls)), CREDIT_SCHEMA)
        recommendation = str(answer.get("recommendation", "")).strip().upper()
        if recommendation in RECOMMENDATIONS:
            proposal = {
                "recommendation": recommendation,
                "reason": clip(answer.get("reason", ""), 600) or "No reason given",
            }
    except OllamaError as exc:
        ctx.logger.warning(f"NO AI PROPOSAL | {exc}")

    try:
        decision = await circuit.submit_decision(persona_id, proposal, model)
    except AgentCircuitError as exc:
        return f"AgentCircuit rejected the decision: {exc}"

    rules = "; ".join(str(rule) for rule in decision.get("rules") or [])
    if proposal is None:
        ai_line = "No AI proposal (Ollama unavailable); AgentCircuit policy decided alone."
    else:
        verdict = "OVERRIDDEN by policy" if decision.get("overridden") else "confirmed by policy"
        ai_line = f"AI ({model}) proposed {proposal['recommendation']}: {proposal['reason']} ({verdict})"
    return (
        f"Applicant {persona_id} ({PERSONAS[persona_id]}): FINAL {decision.get('final')} "
        f"-> next step {decision.get('route')}.\n"
        f"Policy: {rules}.\n"
        f"{ai_line}\n"
        f"Data access through AgentCircuit: {', '.join(access)}. "
        "CRS sandbox data, simulated cost."
    )


@gateway.on_event("startup")
async def startup(ctx: Context):
    try:
        result = await circuit.enroll(gateway.name)
        note = "already enrolled" if result.get("alreadyEnrolled") else "enrolled"
        ctx.logger.info(f"IDENTITY | credit (gateway) | {note} | {gateway.address}")
    except AgentCircuitError as exc:
        ctx.logger.error(f"ENROLLMENT FAILED | {exc} | is the Next.js dev server running?")


@chat.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id),
    )
    text = " ".join(item.text for item in msg.content if isinstance(item, TextContent))
    ctx.logger.info(f"CHAT | from {sender[:16]}… | {clip(text, 200)}")
    match = re.search(r"\bP\s?(01|13|14|15|17)\b", text, re.IGNORECASE)
    if not match:
        await ctx.send(sender, reply(HELP))
        return

    persona_id = f"P{match.group(1)}"
    async with lock:
        # Enrollment is cleared by Reset on /control; re-enroll before each request.
        try:
            await circuit.enroll(gateway.name)
        except AgentCircuitError as exc:
            await ctx.send(sender, reply(f"AgentCircuit is unavailable: {exc}"))
            return
        answer = await underwrite(ctx, persona_id)
    ctx.logger.info(f"CHAT REPLY | {clip(answer, 300)}")
    await ctx.send(sender, reply(answer))


@chat.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


gateway.include(chat, publish_manifest=True)

if __name__ == "__main__":
    gateway.run()
