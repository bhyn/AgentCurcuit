from auto_enroll import ensure_agents_enrolled
import hashlib
import base64
import binascii
import re
import json
import secrets
import time
from pathlib import Path

import httpx
import os
from ai_workflow_planner import choose_agent_action, get_ai_provider
from activity_reporter import report_activity
from ai_plan_reporter import report_ai_plan
from uagents_core.types import DeliveryStatus
from dotenv import dotenv_values
from uagents import Agent, Bureau, Context, Model
from uagents_core.identity import Identity

# AgentCircuit connection
ROOT = Path(__file__).resolve().parent.parent
config = dotenv_values(ROOT / ".env.local")

API = "http://127.0.0.1:3000/api/control/agent-request"
USER_GOAL = os.getenv(
    "AGENTCIRCUIT_DEMO_GOAL",
    "Investigate possible fraud in the P01 TransUnion credit report, "
    "then test whether the payment agent can access it.",
)
PATH = "/api/control/agent-request"

# A single explicit CRS sandbox persona is used for the entire workflow.
# Only the local, validated fixture registry may authorize a persona ID.
PERSONA_CATALOG_URL = "http://127.0.0.1:3000/api/control/personas"


def persona_from_goal(goal: str) -> str:
    mentioned = set(re.findall(r"(?<![A-Za-z0-9])P\d+(?![A-Za-z0-9])", goal.upper()))
    invalid = [item for item in mentioned if not re.fullmatch(r"P\d{2,3}", item)]
    if invalid:
        raise ValueError(f"Invalid CRS persona ID: {', '.join(sorted(invalid))}")
    candidates = mentioned
    if len(candidates) > 1:
        raise ValueError("Specify exactly one CRS persona per workflow (e.g. P13).")
    return next(iter(candidates), "P01")


def bureau_from_goal(goal: str) -> str:
    matches = [b for b in ("transunion", "equifax", "experian") if b in goal.lower()]
    if len(matches) > 1:
        raise ValueError("Specify exactly one credit bureau per workflow.")
    return matches[0] if matches else "transunion"


async def validate_persona(persona_id: str) -> None:
    """Fail closed: unsupported names must never reach a real CRS vendor."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(PERSONA_CATALOG_URL)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError, TypeError) as error:
        raise RuntimeError("CRS persona catalog unavailable; no credit request made") from error
    registered = data.get("personas") if isinstance(data, dict) else None
    if not isinstance(registered, list) or persona_id not in registered:
        available = ", ".join(registered) if isinstance(registered, list) else "none"
        raise ValueError(
            f"{persona_id} is not configured in local CRS sandbox fixtures. "
            f"Available: {available}. No credit request made."
        )


SEEDS = {
    "credit": config.get("CREDIT_AGENT_SEED_PHRASE"),
    "fraud": config.get("FRAUD_AGENT_SEED_PHRASE"),
    "payment": config.get("AGENT_SEED_PHRASE"),
}

for role, seed in SEEDS.items():
    if not seed:
        raise SystemExit(f"Missing seed for {role}")

# Fetch.ai message types
class WorkOrder(Model):
    persona_id: str
    bureau: str
    task: str


class WorkResult(Model):
    role: str
    decision: str
    success: bool


# Three independent agents with registered identities
credit = Agent(
    name="coordinated_credit",
    seed=SEEDS["credit"],
)

fraud = Agent(
    name="coordinated_fraud",
    seed=SEEDS["fraud"],
)

payment = Agent(
    name="coordinated_payment",
    seed=SEEDS["payment"],
)

AGENTS = {
    "credit": credit,
    "fraud": fraud,
    "payment": payment,
}

# Check that each uAgent matches its signing identity
for role, agent in AGENTS.items():
    expected = Identity.from_seed(SEEDS[role], 0).address

    if agent.address.lower() != expected.lower():
        raise SystemExit(
            f"{role} identity mismatch"
        )

print("All three signed agent identities verified.")


async def request_control(ctx, role, order):
    identity = Identity.from_seed(SEEDS[role], 0)

    body = {
        "personaId": order.persona_id,
        "bureau": order.bureau,
        "claimedRole": role,
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

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            API,
            headers=headers,
            content=raw.encode("utf-8"),
        )

    try:
        result = response.json()
    except ValueError:
        raise RuntimeError(
            f"AgentCircuit HTTP {response.status_code}: "
            "Non-JSON response"
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"AgentCircuit HTTP {response.status_code}: "
            f"{result.get('error', result.get('detail'))}"
        )

    ctx.logger.info(
        f"AGENTCIRCUIT | {role.upper()} "
        f"| {result.get('decision')} "
        f"| source={result.get('source', 'N/A')}"
    )

    return result



# 1. Credit checks the report, then asks the selected AI model
# which agent should handle the next task.

async def record_ai_choice(ctx, plan, stage):
    try:
        await report_ai_plan(plan, stage=stage)
        ctx.logger.info(
            f"AI DECISION RECORDED | {plan['provider'].upper()} | "
            f"{stage} | {plan['next_agent']} / {plan['task']}"
        )
    except Exception as error:
        ctx.logger.warning(f"AI decision reporting failed: {error}")


async def record(ctx, role, kind, detail, target=None):
    try:
        await report_activity(
            role=role,
            event_type=kind,
            detail=detail,
            target=target,
        )
    except Exception as error:
        ctx.logger.warning(
            f"Dashboard reporting failed: {error}"
        )


async def run_x402_dry_run(
    ctx, order: WorkOrder, *, budget_limit_atomic: int = 10000
) -> tuple[str, bool, str]:
    """Inspect the local x402 HTTP challenge directly; no wallet or subprocess.

    The Fetch.ai message sender is validated in payment_receive. This local
    policy preview is NOT a signed x402 payment or a settlement authorization.
    """
    # Persona was checked against the server-side CRS fixture registry before
    # the credit request. The x402 resource is synthetic; it is NOT actual CRS data.
    ctx.logger.info(
        f"X402 | {order.persona_id} / {order.bureau} | "
        "Inspecting synthetic paid API (DRY RUN; no wallet signing)"
    )
    if budget_limit_atomic < 10000:
        ctx.logger.info(
            "X402 | OVER-BUDGET TEST: demo budget $0.005; API price $0.01"
        )
    url = "http://127.0.0.1:3000/api/control/x402/report"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            response = await client.get(
                url,
                params={"personaId": order.persona_id},
                headers={"Cache-Control": "no-store"},
            )
    except httpx.HTTPError as error:
        detail = f"Could not contact local x402 API ({type(error).__name__})"
        ctx.logger.error(f"X402 | CHECK FAILED | {detail}")
        return "X402_CHECK_FAILED", False, detail

    ctx.logger.info(f"X402 | API HTTP STATUS: {response.status_code}")
    if response.status_code != 402:
        detail = (
            "x402 API returned 503: verify X402_PAY_TO and restart Next.js"
            if response.status_code == 503
            else f"Expected HTTP 402 from local paid API; got HTTP {response.status_code}"
        )
        ctx.logger.error(f"X402 | CHECK FAILED | {detail}")
        return "X402_CHECK_FAILED", False, detail

    required = response.headers.get("PAYMENT-REQUIRED")
    if not required:
        detail = "HTTP 402 is missing PAYMENT-REQUIRED header"
        ctx.logger.error(f"X402 | CHECK FAILED | {detail}")
        return "X402_CHECK_FAILED", False, detail

    try:
        challenge = json.loads(base64.b64decode(required, validate=True).decode("utf-8"))
        accepts = challenge.get("accepts")
        if not isinstance(accepts, list):
            raise ValueError("Invalid accepts")
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error, AttributeError):
        detail = "Invalid x402 PAYMENT-REQUIRED challenge"
        ctx.logger.error(f"X402 | CHECK FAILED | {detail}")
        return "X402_CHECK_FAILED", False, detail

    ctx.logger.info("X402 | HTTP 402 PAYMENT-REQUIRED received")
    offers = [
        offer for offer in accepts
        if isinstance(offer, dict)
        and offer.get("scheme") == "exact"
        and offer.get("network") == "eip155:84532"
    ]
    if not offers:
        detail = "No exact Base Sepolia payment option offered"
        ctx.logger.warning(f"X402 | POLICY BLOCKED | {detail}")
        return "X402_POLICY_BLOCKED", False, detail

    # The demo policy is *only* a spending/recipient preview, not financial
    # authorization. Pay-to must be an address controlled by the user before
    # any real payment; an unbacked placeholder is for no-payment tests only.
    configured_pay_to = str(config.get("X402_PAY_TO") or "").strip()
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", configured_pay_to):
        detail = "X402_PAY_TO is missing or invalid (no payment attempted)"
        ctx.logger.warning(f"X402 | POLICY BLOCKED | {detail}")
        return "X402_POLICY_BLOCKED", False, detail

    valid_offer = False
    for offer in offers:
        amount_text = str(offer.get("amount", ""))
        recipient = offer.get("payTo", "")
        if (
            re.fullmatch(r"[0-9]+", amount_text)
            and isinstance(recipient, str)
            and recipient.lower() == configured_pay_to.lower()
        ):
            offered_amount = int(amount_text)
            if offered_amount > budget_limit_atomic:
                detail = (
                    f"Demo budget exceeded: offered ${offered_amount / 1e6:.3f} USDC "
                    f"but permitted limit is ${budget_limit_atomic / 1e6:.3f} USDC; "
                    "NO PAYMENT"
                )
                ctx.logger.warning(f"X402 | POLICY BLOCKED | {detail}")
                return "X402_POLICY_BLOCKED", False, detail
            if offered_amount >= 1:
                valid_offer = True
                break

    if not valid_offer:
        detail = "x402 offer recipient or amount does not match local demo policy"
        ctx.logger.warning(f"X402 | POLICY BLOCKED | {detail}")
        return "X402_POLICY_BLOCKED", False, detail

    ctx.logger.info("X402 | POLICY ALLOWED | NO SIGNATURE | NO PAYMENT")
    return "X402_DRY_RUN_ALLOWED", True, "HTTP 402 / local demo policy passed; no payment"


async def send_logged(ctx, role, target, address, message):
    delivery = await ctx.send(address, message)

    if getattr(delivery, "status", None) == DeliveryStatus.FAILED:
        ctx.logger.error(
            f"Fetch.ai delivery failed: {role} -> {target}"
        )
        return delivery

    await record(
        ctx,
        role,
        "MESSAGE_SENT",
        f"{type(message).__name__} sent to {target}",
        target,
    )
    return delivery

@credit.on_event("startup")
async def credit_start(ctx: Context):
    try:
        persona_id = persona_from_goal(USER_GOAL)
        bureau = bureau_from_goal(USER_GOAL)
        await validate_persona(persona_id)
        ctx.logger.info(f"AI PROVIDER SELECTED: {get_ai_provider().upper()}")
        ctx.logger.info(f"CRS PERSONA SELECTED: {persona_id} | bureau={bureau}")
        order = WorkOrder(
            persona_id=persona_id,
            bureau=bureau,
            task="check_credit",
        )
        result = await request_control(
            ctx, "credit", order
        )

        if (
            result.get("decision") not in ("ALLOW", "REUSE")
            or result.get("success") is not True
        ):
            ctx.logger.error("WORKFLOW FAILED: credit check rejected or unsuccessful")
            return

        ctx.logger.info("CREDIT CHECK COMPLETE")

        # AI chooses the next task.
        routing = await choose_agent_action(
            user_goal=USER_GOAL,
            stage="after_credit",
            previous_decision=result["decision"],
        )

        await record_ai_choice(ctx, routing, "after_credit")

        next_agent = routing["next_agent"]

        ctx.logger.info(
            f"{routing['provider'].upper()} AI SELECTED: {next_agent}"
        )
        ctx.logger.info(
            f"{routing['provider'].upper()} AI REASON: {routing['reason']}"
        )

        if next_agent == "finish":
            ctx.logger.info(
                "WORKFLOW COMPLETE: AI selected finish"
            )
            await record(ctx, "credit", "WORKFLOW_COMPLETE", "AI selected finish after credit")
            return

        # The AI selects a destination, not permissions.
        # Only known agents can receive a task.
        destinations = {
            "fraud": fraud.address,
            "payment": payment.address,
        }

        destination = destinations[next_agent]

        next_order = WorkOrder(
            persona_id=order.persona_id,
            bureau=order.bureau,
            task=routing["task"],
        )

        ctx.logger.info(
            f"FETCH MESSAGE | Credit -> {next_agent}"
        )

        await send_logged(ctx, "credit", next_agent, destination, next_order)

    except Exception as error:
        ctx.logger.error(
            f"WORKFLOW FAILED: credit workflow error ({error})"
        )




# 2. Fraud receives Credit's message
@fraud.on_message(model=WorkOrder)
async def fraud_receive(
    ctx: Context, sender: str, msg: WorkOrder
):
    if sender != credit.address:
        ctx.logger.warning("Unknown sender rejected")
        return

    ctx.logger.info(
        "MESSAGE RECEIVED | Credit -> Fraud"
    )
    await record(ctx, "fraud", "MESSAGE_RECEIVED", "WorkOrder received from credit", "credit")

    try:
        result = await request_control(
            ctx, "fraud", msg
        )

        await send_logged(ctx, "fraud", "credit",
            sender,
            WorkResult(
                role="fraud",
                decision=result.get("decision", "ERROR"),
                success=result.get("success") is True,
            ),
        )

        ctx.logger.info("MESSAGE | Fraud -> Credit")

    except Exception as error:
        ctx.logger.error(f"WORKFLOW FAILED: fraud error ({error})")



# 3. Credit receives agent results.
# The selected model decides what happens after Fraud.
@credit.on_message(model=WorkResult)
async def credit_receive(
    ctx: Context,
    sender: str,
    msg: WorkResult,
):
    if sender == fraud.address:
        if msg.role != "fraud":
            ctx.logger.warning("Invalid fraud result role")
            return

        ctx.logger.info(
            f"MESSAGE RECEIVED | Fraud -> Credit "
            f"| {msg.decision}"
        )

        await record(ctx, "credit", "MESSAGE_RECEIVED", "WorkResult received from fraud", "fraud")

        if not msg.success:
            ctx.logger.error("WORKFLOW FAILED: fraud step unsuccessful")
            return

        try:
            routing = await choose_agent_action(
                user_goal=USER_GOAL,
                stage="after_fraud",
                previous_decision=msg.decision,
            )

            await record_ai_choice(ctx, routing, "after_fraud")

            next_agent = routing["next_agent"]

            ctx.logger.info(
                f"{routing['provider'].upper()} AFTER FRAUD: {next_agent}"
            )
            ctx.logger.info(
                f"{routing['provider'].upper()} REASON: {routing['reason']}"
            )

            if next_agent == "finish":
                ctx.logger.info(
                    "WORKFLOW COMPLETE: "
                    "AI decided no further task is needed"
                )
                await record(ctx, "credit", "WORKFLOW_COMPLETE", "AI selected finish after fraud")
                return

            if next_agent == "payment":
                ctx.logger.info(
                    "FETCH MESSAGE | Credit -> Payment"
                )

                await send_logged(ctx, "credit", "payment",
                    payment.address,
                    WorkOrder(
                        persona_id=persona_from_goal(USER_GOAL),
                        bureau=bureau_from_goal(USER_GOAL),
                        task=routing["task"],
                    ),
                )

        except Exception as error:
            ctx.logger.error(
                f"WORKFLOW FAILED: AI handoff error ({error})"
            )
            # Do not delegate when the AI router fails.
            return

    elif sender == payment.address:
        if msg.role != "payment":
            ctx.logger.warning("Invalid payment result role")
            return

        ctx.logger.info(
            f"MESSAGE RECEIVED | Payment -> Credit "
            f"| {msg.decision}"
        )

        await record(ctx, "credit", "MESSAGE_RECEIVED", "WorkResult received from payment", "payment")

        if msg.decision == "BLOCK":
            ctx.logger.info(
                "WORKFLOW COMPLETE: "
                "Unauthorized access blocked!"
            )
            await record(ctx, "credit", "WORKFLOW_COMPLETE", "Payment credit access blocked by AgentCircuit")
        elif msg.decision == "X402_DRY_RUN_ALLOWED" and msg.success:
            ctx.logger.info("WORKFLOW COMPLETE: x402 policy allowed (DRY RUN; NO PAYMENT)")
            await record(ctx, "credit", "WORKFLOW_COMPLETE", "x402 402 challenge and demo policy passed; no payment")
        elif msg.decision == "X402_POLICY_BLOCKED":
            ctx.logger.info("WORKFLOW COMPLETE: x402 demo policy blocked payment")
            await record(ctx, "credit", "WORKFLOW_COMPLETE", "x402 policy rejected offer; no payment")
        elif msg.decision == "X402_CHECK_FAILED":
            ctx.logger.error("WORKFLOW FAILED: x402 dry-run could not complete")
            await record(ctx, "credit", "WORKFLOW_COMPLETE", "FAILED: x402 dry-run could not complete; no payment")
        else:
            ctx.logger.error(
                f"WORKFLOW FAILED: Unexpected payment decision: {msg.decision}"
            )


# 4. Payment attempts access
@payment.on_message(model=WorkOrder)
async def payment_receive(
    ctx: Context, sender: str, msg: WorkOrder
):
    if sender != credit.address:
        ctx.logger.warning("Unknown sender rejected")
        return

    ctx.logger.info(
        "MESSAGE RECEIVED | Credit -> Payment"
    )
    await record(ctx, "payment", "MESSAGE_RECEIVED", "WorkOrder received from credit", "credit")

    try:
        if msg.task in ("x402_payment_dry_run", "x402_over_budget_dry_run"):
            # The spending-limit case is a synthetic *denial* test, not payment.
            budget_limit = 5000 if msg.task == "x402_over_budget_dry_run" else 10000
            decision, succeeded, detail = await run_x402_dry_run(
                ctx, msg, budget_limit_atomic=budget_limit
            )
            ctx.logger.info(f"X402 RESULT | {decision} | {detail}")
            await send_logged(ctx, "payment", "credit",
                sender,
                WorkResult(role="payment", decision=decision, success=succeeded),
            )
        elif msg.task == "payment_credit_access":
            # Preserve the original verified-signature / unauthorized-access demo.
            result = await request_control(ctx, "payment", msg)
            await send_logged(ctx, "payment", "credit",
                sender,
                WorkResult(
                    role="payment",
                    decision=result.get("decision", "ERROR"),
                    success=result.get("success") is True,
                ),
            )
        else:
            ctx.logger.error(f"WORKFLOW FAILED: Payment rejected unknown task: {msg.task}")
            return

        ctx.logger.info("MESSAGE | Payment -> Credit")

    except Exception as error:
        ctx.logger.error(f"WORKFLOW FAILED: Payment error ({error})")


if __name__ == "__main__":
    ensure_agents_enrolled()

    bureau = Bureau(
        agents=[credit, fraud, payment],
        port=8077,
    )
    bureau.run()
