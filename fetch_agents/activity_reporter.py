
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

PATH = "/api/control/activity"
URL = "http://127.0.0.1:3000" + PATH

SEED_KEYS = {
    "credit": "CREDIT_AGENT_SEED_PHRASE",
    "fraud": "FRAUD_AGENT_SEED_PHRASE",
    "payment": "AGENT_SEED_PHRASE",
}

ALLOWED_TYPES = {
    "MESSAGE_SENT",
    "MESSAGE_RECEIVED",
    "FRAUD_ASSESSMENT",
    "WORKFLOW_COMPLETE",
}


async def report_activity(
    role: str,
    event_type: str,
    detail: str,
    target: str | None = None,
) -> bool:

    if role not in SEED_KEYS:
        raise ValueError(f"Unknown role: {role}")

    if event_type not in ALLOWED_TYPES:
        raise ValueError(
            f"Agent cannot submit event: {event_type}"
        )

    seed = CONFIG.get(SEED_KEYS[role])
    if not seed:
        raise RuntimeError(f"Missing seed for {role}")

    identity = Identity.from_seed(seed, 0)

    body = {
        "type": event_type,
        "agent": role,
        "detail": detail[:600],
    }

    if target is not None:
        body["target"] = target

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

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            URL,
            headers=headers,
            content=raw.encode("utf-8"),
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"Activity HTTP {response.status_code}: "
            f"{response.text[:300]}"
        )

    return response.json().get("ok") is True
