"""Fetch.ai credit workflow governed by AgentCircuit, with local Ollama advice.

Three uAgents (credit, fraud, payment) run in one Bureau. Every AgentCircuit request is
signed with the sending agent's uAgent identity, and AgentCircuit decides what each agent
may do from the verified address. Ollama only proposes; AgentCircuit's policy makes the
final underwriting decision and picks the next step.

Usage (Next.js dev server on port 3000 and Ollama running locally):
    python fetch_agents/ai_agents_dashboard.py [P01|P13|P14|P15|P17] [--rogue-payment]

Development-only demo on CRS sandbox personas. Activity events carry summaries only,
never credit-report contents or credentials.
"""
import argparse
import asyncio
import json
import logging
import os
import sys

from uagents import Agent, Bureau, Context, Model
from uagents_core.types import DeliveryStatus

from agentcircuit_client import (
    AGENTCIRCUIT_URL,
    BUREAUS,
    OLLAMA_MODEL,
    OLLAMA_URL,
    OPERATOR_TOKEN,
    ROOT,
    AgentCircuit,
    AgentCircuitError,
    OllamaError,
    clip,
    facts_text,
    ollama_json,
    short_address,
)

PERSONAS = ("P01", "P13", "P14", "P15", "P17")
RECOMMENDATIONS = ("APPROVE", "REVIEW", "DECLINE")
RISKS = ("low", "medium", "high")
ROUTES = ("payment", "fraud", "finish")
ENROLL_TIMEOUT = 30

parser = argparse.ArgumentParser(
    description="Run the credit, fraud and payment agents through AgentCircuit."
)
parser.add_argument("persona", nargs="?", default="P01", type=str.upper, choices=PERSONAS,
                    help="CRS sandbox persona (default: P01)")
parser.add_argument("--rogue-payment", action="store_true",
                    help="payment agent also tries to pose as credit and to pay without approval")
args = parser.parse_args()
PERSONA = args.persona
ROGUE = args.rogue_payment

if not OPERATOR_TOKEN:
    raise SystemExit("AGENTCIRCUIT_AGENT_TOKEN is missing from .env.local (needed for enrollment)")

# Model output can contain characters the console code page cannot print.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

# uagents reads identity keys from ./private_keys.json relative to the working directory,
# so run from the project root to reuse the existing dashboard_* identities.
os.chdir(ROOT)


class FraudReview(Model):
    persona_id: str
    facts_json: str
    rules: list[str]


class FraudReviewResult(Model):
    persona_id: str
    risk: str
    reason: str
    consistent: bool


class Disburse(Model):
    persona_id: str
    decision: str


class PaymentResult(Model):
    persona_id: str
    decision: str
    detail: str


credit = Agent(name="dashboard_credit_agent")
fraud = Agent(name="dashboard_fraud_agent")
payment = Agent(name="dashboard_payment_agent")
AGENTS = {"credit": credit, "fraud": fraud, "payment": payment}

# One signed AgentCircuit client per agent, logging through that agent's logger.
circuits = {
    role: AgentCircuit(agent, role, logger=logging.getLogger(agent.name))
    for role, agent in AGENTS.items()
}
enrolled = {role: asyncio.Event() for role in AGENTS}
probe_done = asyncio.Event()

CREDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "recommendation": {"type": "string", "enum": list(RECOMMENDATIONS)},
        "reason": {"type": "string"},
    },
    "required": ["recommendation", "reason"],
}

FRAUD_SCHEMA = {
    "type": "object",
    "properties": {
        "risk": {"type": "string", "enum": list(RISKS)},
        "reason": {"type": "string"},
    },
    "required": ["risk", "reason"],
}


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


def fraud_prompt(facts: str, rules: list[str], consistent: bool) -> str:
    match = "match" if consistent else "do NOT match"
    reasons = "\n".join(f"- {rule}" for rule in rules) or "- none given"
    return (
        "You are a fraud analyst. The underwriting policy sent this synthetic test credit "
        "application to manual review.\n"
        f"Policy review reasons:\n{reasons}\n"
        f"Independent re-check: the facts in the review request {match} the bureau data "
        "AgentCircuit returned to the fraud agent.\n"
        f"Bureau facts:\n{facts}\n\n"
        "Rate the fraud risk as low, medium or high.\n"
        'Answer in JSON: {"risk": "low" | "medium" | "high", '
        '"reason": "<one sentence citing the facts>"}'
    )


def parse_proposal(answer: dict) -> dict:
    recommendation = str(answer.get("recommendation", "")).strip().upper()
    if recommendation not in RECOMMENDATIONS:
        raise OllamaError(f"unexpected recommendation {recommendation!r}")
    reason = clip(answer.get("reason", ""), 600) or "No reason given"
    return {"recommendation": recommendation, "reason": reason}


def bureau_view(item: dict | None) -> tuple | None:
    """Comparable (status, scores, error codes) for one bureau, or None without data.

    Accepts a BureauSummary (agent-request) or a BureauFacts entry (decision response).
    """
    if not isinstance(item, dict):
        return None
    if "errors" in item:
        codes = [e.get("code") for e in item.get("errors") or [] if isinstance(e, dict)]
    elif item.get("available"):
        codes = item.get("errorCodes") or []
    else:
        return None
    scores = tuple(s for s in item.get("scores") or [] if isinstance(s, (int, float)))
    return item.get("status"), scores, tuple(sorted(str(c) for c in codes if c))


def facts_match(facts_json: str, pulls: dict[str, dict]) -> bool:
    """True when the facts in the review request equal the fraud agent's own pulls."""
    try:
        claimed = {
            item.get("bureau"): bureau_view(item)
            for item in json.loads(facts_json)
            if isinstance(item, dict)
        }
    except (TypeError, ValueError):
        return False
    if set(claimed) != set(BUREAUS):
        return False
    return all(claimed[b] == bureau_view(pulls[b].get("summary")) for b in BUREAUS)


async def send(ctx: Context, role: str, target: str, message: Model) -> None:
    """Send a Fetch.ai message and show it on the dashboard."""
    kind = type(message).__name__
    status = await ctx.send(AGENTS[target].address, message)
    if status.status == DeliveryStatus.FAILED:
        ctx.logger.error(f"FETCH MESSAGE FAILED | {role} -> {target} | {kind}: {status.detail}")
        return
    ctx.logger.info(f"FETCH MESSAGE | {role} -> {target} | {kind}")
    await circuits[role].activity(
        "MESSAGE_SENT", f"{kind} for {message.persona_id} sent via Fetch.ai", target=target
    )


async def received(ctx: Context, role: str, source: str, message: Model) -> None:
    kind = type(message).__name__
    ctx.logger.info(f"FETCH MESSAGE RECEIVED | {source} -> {role} | {kind}")
    await circuits[role].activity(
        "MESSAGE_RECEIVED",
        f"{kind} for {message.persona_id} received from {source.capitalize()}",
        target=source,
    )


async def complete(ctx: Context, detail: str) -> None:
    ctx.logger.info(f"WORKFLOW COMPLETE | {detail}")
    await circuits["credit"].activity("WORKFLOW_COMPLETE", detail)
    ctx.logger.info("Press Ctrl+C to stop the agents.")


async def enroll(ctx: Context, role: str) -> bool:
    agent = AGENTS[role]
    try:
        result = await circuits[role].enroll(agent.name)
    except AgentCircuitError as exc:
        ctx.logger.error(f"ENROLLMENT FAILED | {role} | {exc}")
        return False
    note = "already enrolled" if result.get("alreadyEnrolled") else "enrolled"
    ctx.logger.info(f"IDENTITY | {role} | {note} | {agent.address}")
    enrolled[role].set()
    return True


async def pull_bureaus(ctx: Context, role: str, persona_id: str) -> dict[str, dict]:
    """Request all three bureau reports through AgentCircuit concurrently."""

    async def pull(bureau: str) -> dict:
        try:
            return await circuits[role].credit_report(persona_id, bureau)
        except AgentCircuitError as exc:
            return {"decision": "ERROR", "detail": str(exc)}

    results = dict(zip(BUREAUS, await asyncio.gather(*(pull(b) for b in BUREAUS))))
    for bureau, result in results.items():
        decision = result.get("decision", "?")
        if isinstance(result.get("summary"), dict):
            ctx.logger.info(
                f"AGENTCIRCUIT | {role} | {persona_id} {bureau} | {decision} "
                f"via {result.get('source')} | requestId={result.get('requestId')}"
            )
        else:
            reason = f" ({result['reason']})" if result.get("reason") else ""
            budget = result.get("reason") == "budget"
            hint = " | press Reset on /control to restore it" if budget else ""
            ctx.logger.warning(
                f"AGENTCIRCUIT | {role} | {persona_id} {bureau} | {decision}{reason}: "
                f"{result.get('detail', '')}{hint}"
            )
    return results


def all_failed(pulls: dict[str, dict]) -> bool:
    """True when no bureau request got an answer from AgentCircuit's policy."""
    return all(result.get("decision") == "ERROR" for result in pulls.values())


async def run_workflow(ctx: Context) -> None:
    ctx.logger.info(f"WORKFLOW | {PERSONA} | pulling three bureaus through AgentCircuit")
    pulls = await pull_bureaus(ctx, "credit", PERSONA)
    if all_failed(pulls):
        ctx.logger.error("WORKFLOW STOPPED | no bureau request got through AgentCircuit (see above)")
        return

    # The model sees only AgentCircuit's summaries, never raw credit files.
    proposal, model = None, None
    try:
        answer, model = await ollama_json(credit_prompt(facts_text(pulls)), CREDIT_SCHEMA)
        proposal = parse_proposal(answer)
        ctx.logger.info(
            f"OLLAMA | {model} proposes {proposal['recommendation']}: {proposal['reason']}"
        )
    except OllamaError as exc:
        model = None
        ctx.logger.warning(f"NO AI PROPOSAL | {exc} | AgentCircuit policy decides alone")

    try:
        decision = await circuits["credit"].submit_decision(PERSONA, proposal, model)
    except AgentCircuitError as exc:
        ctx.logger.error(f"DECISION REJECTED | {exc}")
        return
    final, route = decision.get("final"), decision.get("route")
    if route not in ROUTES:
        ctx.logger.error(f"WORKFLOW STOPPED | unexpected decision response: {decision}")
        return

    rules = [str(rule) for rule in decision.get("rules") or []]
    if decision.get("overridden"):
        proposed = (decision.get("proposal") or {}).get("recommendation")
        ctx.logger.warning(f"SAFETY OVERRIDE | AI proposed {proposed}, AgentCircuit decided {final}")
    ctx.logger.info(f"POLICY | {PERSONA} | final {final} -> {route} | {'; '.join(rules)}")

    if route == "payment":
        await send(ctx, "credit", "payment", Disburse(persona_id=PERSONA, decision=final))
    elif route == "fraud":
        facts_json = json.dumps(decision.get("facts") or [], separators=(",", ":"))
        await send(ctx, "credit", "fraud",
                   FraudReview(persona_id=PERSONA, facts_json=facts_json, rules=rules))
    else:
        await complete(ctx, f"{PERSONA}: {final}, no further work ({'; '.join(rules)})")


async def assess_fraud(ctx: Context, facts: str, rules: list[str],
                       consistent: bool) -> tuple[str, str, str | None]:
    """Returns (risk, reason, model). Mismatched facts always mean high risk."""
    try:
        answer, model = await ollama_json(fraud_prompt(facts, rules, consistent), FRAUD_SCHEMA)
        risk = str(answer.get("risk", "")).strip().lower()
        if risk not in RISKS:
            raise OllamaError(f"unexpected risk {risk!r}")
    except OllamaError as exc:
        ctx.logger.warning(f"NO AI ASSESSMENT | {exc}")
        risk = "medium" if consistent else "high"
        return risk, "AI assessment unavailable; the case stays in manual review", None
    reason = clip(answer.get("reason", ""), 400) or "No reason given"
    if not consistent and risk != "high":
        ctx.logger.warning(f"RISK RAISED | {model} said {risk}, but the facts did not match")
        reason = f"{model} rated {risk}, raised to high: {reason}"
        risk = "high"
    return risk, reason, model


async def rogue_probe(ctx: Context) -> None:
    """--rogue-payment: the payment agent tries to act beyond its enrolled role."""
    circuit = circuits["payment"]
    try:
        try:
            result = await circuit.credit_report(PERSONA, "transunion", claimed_role="credit")
            ctx.logger.warning(
                f"ROGUE | credit report claiming role 'credit' -> {result.get('decision')} "
                f"({result.get('reason', '-')}): {result.get('detail', '')}"
            )
        except AgentCircuitError as exc:
            ctx.logger.error(f"ROGUE | credit report request failed: {exc}")
        try:
            result = await circuit.request_payment(PERSONA)
            ctx.logger.warning(
                f"ROGUE | payment before approval -> {result.get('decision')}: "
                f"{result.get('detail', '')}"
            )
            if result.get("decision") == "AUTHORIZED":
                ctx.logger.warning(
                    f"ROGUE | an approval for {PERSONA} from an earlier run is still stored; "
                    "press Reset on /control to clear it"
                )
        except AgentCircuitError as exc:
            ctx.logger.error(f"ROGUE | payment request failed: {exc}")
    finally:
        probe_done.set()


@credit.on_event("startup")
async def credit_start(ctx: Context):
    if not await enroll(ctx, "credit"):
        return
    waits = [event.wait() for event in enrolled.values()]
    if ROGUE:
        # Probe first, so this run's approval cannot authorize the rogue payment.
        waits.append(probe_done.wait())
    try:
        await asyncio.wait_for(asyncio.gather(*waits), timeout=ENROLL_TIMEOUT)
    except TimeoutError:
        missing = [role for role, event in enrolled.items() if not event.is_set()]
        waiting_for = ", ".join(missing) or "the rogue payment probe"
        ctx.logger.error(f"WORKFLOW STOPPED | {waiting_for} not ready after {ENROLL_TIMEOUT} s")
        return
    await run_workflow(ctx)


@fraud.on_event("startup")
async def fraud_start(ctx: Context):
    await enroll(ctx, "fraud")


@payment.on_event("startup")
async def payment_start(ctx: Context):
    if await enroll(ctx, "payment") and ROGUE:
        await rogue_probe(ctx)


@fraud.on_message(model=FraudReview)
async def fraud_review(ctx: Context, sender: str, msg: FraudReview):
    if sender != credit.address:
        ctx.logger.warning(f"Ignored FraudReview from unknown sender {short_address(sender)}")
        return
    await received(ctx, "fraud", "credit", msg)

    # Re-pull independently: AgentCircuit serves the same reports from its cache at no cost.
    pulls = await pull_bureaus(ctx, "fraud", msg.persona_id)
    if all_failed(pulls):
        ctx.logger.error("FRAUD CHECK | could not re-pull the bureau facts (see above)")
        consistent, model = False, None
        risk, reason = "high", "Could not re-pull the bureau facts through AgentCircuit"
    else:
        consistent = facts_match(msg.facts_json, pulls)
        ctx.logger.info(f"FRAUD CHECK | {msg.persona_id} | facts consistent={consistent}")
        risk, reason, model = await assess_fraud(ctx, facts_text(pulls), msg.rules, consistent)

    ctx.logger.info(f"FRAUD ASSESSMENT | {msg.persona_id} | risk {risk}: {reason}")
    mismatch = "" if consistent else "The review request did not match AgentCircuit's records. "
    await circuits["fraud"].activity(
        "FRAUD_ASSESSMENT", f"{msg.persona_id}: risk {risk}. {mismatch}{reason}", model=model
    )
    await send(ctx, "fraud", "credit", FraudReviewResult(
        persona_id=msg.persona_id, risk=risk, reason=reason, consistent=consistent
    ))


@payment.on_message(model=Disburse)
async def payment_disburse(ctx: Context, sender: str, msg: Disburse):
    if sender != credit.address:
        ctx.logger.warning(f"Ignored Disburse from unknown sender {short_address(sender)}")
        return
    await received(ctx, "payment", "credit", msg)
    # AgentCircuit authorizes only against its own APPROVE record, not msg.decision.
    try:
        result = await circuits["payment"].request_payment(msg.persona_id)
        decision = str(result.get("decision", "?"))
        detail = str(result.get("detail", ""))
    except AgentCircuitError as exc:
        decision, detail = "ERROR", str(exc)
    log = ctx.logger.info if decision == "AUTHORIZED" else ctx.logger.warning
    log(f"PAYMENT | {msg.persona_id} | {decision}: {detail}")
    await send(ctx, "payment", "credit", PaymentResult(
        persona_id=msg.persona_id, decision=decision, detail=clip(detail, 300)
    ))


@credit.on_message(model=FraudReviewResult)
async def fraud_result(ctx: Context, sender: str, msg: FraudReviewResult):
    if sender != fraud.address:
        ctx.logger.warning(f"Ignored FraudReviewResult from unknown sender {short_address(sender)}")
        return
    await received(ctx, "credit", "fraud", msg)
    check = "facts re-verified" if msg.consistent else "facts did NOT match on re-check"
    await complete(ctx, f"{msg.persona_id}: manual review, fraud risk {msg.risk} ({check})")


@credit.on_message(model=PaymentResult)
async def payment_result(ctx: Context, sender: str, msg: PaymentResult):
    if sender != payment.address:
        ctx.logger.warning(f"Ignored PaymentResult from unknown sender {short_address(sender)}")
        return
    await received(ctx, "credit", "payment", msg)
    await complete(ctx, f"{msg.persona_id}: payment {msg.decision} ({msg.detail})")


if __name__ == "__main__":
    logger = logging.getLogger(credit.name)
    mode = " | rogue payment probe on" if ROGUE else ""
    logger.info(f"AgentCircuit {AGENTCIRCUIT_URL} | Ollama {OLLAMA_URL} ({OLLAMA_MODEL}) | "
                f"persona {PERSONA}{mode}")
    for role, agent in AGENTS.items():
        logger.info(f"{role} agent {agent.name}: {agent.address}")
    bureau = Bureau(agents=[credit, fraud, payment], port=8079)
    bureau.run()
