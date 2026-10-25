
import hashlib
import json
import secrets
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents_core.identity import Identity

ROOT = Path(__file__).resolve().parent.parent
CONFIG = dotenv_values(ROOT / ".env.local")

PATH = "/api/control/route-next"
URL = "http://127.0.0.1:3000" + PATH


async def choose_next_agent(
    user_goal: str,
    stage: str,
    previous_decision: str,
) -> dict:
    seed = CONFIG.get("CREDIT_AGENT_SEED_PHRASE")
    if not seed:
        raise RuntimeError("Missing Credit Agent seed")

    identity = Identity.from_seed(seed, 0)

    body = {
        "userGoal": user_goal,
        "stage": stage,
        "previousDecision": previous_decision,
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

    headers = {
        "Content-Type": "application/json",
        "X-Agent-Address": identity.address,
        "X-Agent-Timestamp": timestamp,
        "X-Agent-Nonce": nonce,
        "X-Agent-Signature": identity.sign_digest(digest),
    }

    async with httpx.AsyncClient(timeout=100) as client:
        response = await client.post(
            URL,
            headers=headers,
            content=raw.encode("utf-8"),
        )

    data = response.json()

    if response.status_code != 200:
        raise RuntimeError(
            f"AI routing HTTP {response.status_code}: "
            f"{data.get('error', 'Unknown error')}"
        )

    return data
