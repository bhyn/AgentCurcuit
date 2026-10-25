
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

seed = config.get("CREDIT_AGENT_SEED_PHRASE")
token = config.get("AGENTCIRCUIT_AGENT_TOKEN")

if not seed or not token:
    raise SystemExit("Missing agent seed or operator token")

# Use the same identity as signed_probe.py.
identity = Identity.from_seed(seed, 0)

path = "/api/control/agents"

# Register this gateway with payment-only permissions.
body = {
    "role": "credit",
    "name": "agentcircuit_credit",
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
    path,
    timestamp,
    nonce,
    body_hash,
])

digest = hashlib.sha256(
    canonical.encode("utf-8")
).digest()

signature = identity.sign_digest(digest)

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "X-Agent-Address": identity.address,
    "X-Agent-Timestamp": timestamp,
    "X-Agent-Nonce": nonce,
    "X-Agent-Signature": signature,
}

print("Enrolling AgentCircuit Gateway...")
print("Role: payment")

try:
    response = httpx.post(
        "http://127.0.0.1:3000" + path,
        headers=headers,
        content=raw.encode("utf-8"),
        timeout=15,
    )

    print("HTTP:", response.status_code)

    data = response.json()

    print("OK:", data.get("ok"))
    print("ROLE:", data.get("role"))
    print("ALREADY ENROLLED:", data.get("alreadyEnrolled"))
    print("ERROR:", data.get("error"))

except Exception as error:
    print("ERROR:", type(error).__name__, str(error))

