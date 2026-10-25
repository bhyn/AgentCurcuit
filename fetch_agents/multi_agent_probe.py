
import hashlib
import json
import secrets
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents_core.identity import Identity

ROOT = Path(__file__).resolve().parent.parent
config = dotenv_values(ROOT / ".env.local")

API_URL = "http://127.0.0.1:3000"
PATH = "/api/control/agent-request"

PERSONA = "P01"
BUREAU = "transunion"

AGENTS = [
    ("credit", "CREDIT_AGENT_SEED_PHRASE"),
    ("fraud", "FRAUD_AGENT_SEED_PHRASE"),
    ("payment", "AGENT_SEED_PHRASE"),
]


def send_signed_request(role, seed):
    identity = Identity.from_seed(seed, 0)

    body = {
        "personaId": PERSONA,
        "bureau": BUREAU,
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

    response = httpx.post(
        API_URL + PATH,
        headers=headers,
        content=raw.encode("utf-8"),
        timeout=30,
    )

    result = response.json()
    return response.status_code, result


print("\n=== AGENTCIRCUIT MULTI-AGENT TEST ===")
print("Persona:", PERSONA)
print("Bureau:", BUREAU)

for role, seed_key in AGENTS:
    seed = config.get(seed_key)

    if not seed:
        print(f"\n{role.upper()}: MISSING SEED")
        continue

    print(f"\n--- {role.upper()} AGENT ---")

    try:
        status, result = send_signed_request(role, seed)

        print("HTTP:", status)
        print("DECISION:", result.get("decision"))
        print("REASON:", result.get("reason"))
        print("SOURCE:", result.get("source"))
        print("SUCCESS:", result.get("success"))
        print(
            "ERROR:",
            result.get("error") or result.get("detail")
        )

    except Exception as error:
        print(
            "ERROR:",
            type(error).__name__,
            str(error),
        )

print("\n=== TEST COMPLETE ===")
