
import hashlib
import json
import secrets
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents import Agent, Bureau, Context, Model
from uagents_core.identity import Identity

# AgentCircuit connection
ROOT = Path(__file__).resolve().parent.parent
config = dotenv_values(ROOT / ".env.local")

API = "http://127.0.0.1:3000/api/control/agent-request"
PATH = "/api/control/agent-request"

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


# 1. Credit checks the report
@credit.on_event("startup")
async def credit_start(ctx: Context):
    order = WorkOrder(
        persona_id="P01",
        bureau="transunion",
        task="check_credit",
    )

    try:
        result = await request_control(
            ctx, "credit", order
        )

        if (
            result.get("decision") not in ("ALLOW", "REUSE")
            or result.get("success") is not True
        ):
            ctx.logger.error("Credit check failed")
            return

        ctx.logger.info("MESSAGE | Credit -> Fraud")

        await ctx.send(
            fraud.address,
            WorkOrder(
                persona_id=order.persona_id,
                bureau=order.bureau,
                task="review_fraud",
            ),
        )

    except Exception as error:
        ctx.logger.error(f"Credit error: {error}")


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

    try:
        result = await request_control(
            ctx, "fraud", msg
        )

        await ctx.send(
            sender,
            WorkResult(
                role="fraud",
                decision=result.get("decision", "ERROR"),
                success=result.get("success") is True,
            ),
        )

        ctx.logger.info("MESSAGE | Fraud -> Credit")

    except Exception as error:
        ctx.logger.error(f"Fraud error: {error}")


# 3. Credit handles responses
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
            ctx.logger.error("Fraud check failed")
            return

        ctx.logger.info("MESSAGE | Credit -> Payment")

        await ctx.send(
            payment.address,
            WorkOrder(
                persona_id="P01",
                bureau="transunion",
                task="payment_credit_access",
            ),
        )

    elif sender == payment.address:
        ctx.logger.info(
            f"MESSAGE RECEIVED | Payment -> Credit "
            f"| {msg.decision}"
        )

        if msg.decision == "BLOCK":
            ctx.logger.info(
                "WORKFLOW COMPLETE: "
                "Unauthorized access blocked!"
            )
        else:
            ctx.logger.warning(
                f"Unexpected payment decision: "
                f"{msg.decision}"
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

    try:
        result = await request_control(
            ctx, "payment", msg
        )

        await ctx.send(
            sender,
            WorkResult(
                role="payment",
                decision=result.get("decision", "ERROR"),
                success=result.get("success") is True,
            ),
        )

        ctx.logger.info("MESSAGE | Payment -> Credit")

    except Exception as error:
        ctx.logger.error(f"Payment error: {error}")


if __name__ == "__main__":
    bureau = Bureau(
        agents=[credit, fraud, payment],
        port=8077,
    )
    bureau.run()
