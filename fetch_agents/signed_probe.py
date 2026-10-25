
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

seed = config.get("AGENT_SEED_PHRASE")

if not seed:
    raise SystemExit("AGENT_SEED_PHRASE missing")

# Same identity as the Agentverse gateway.
identity = Identity.from_seed(seed, 0)

path = "/api/control/agent-request"
timestamp = str(int(time.time() * 1000))
nonce = secrets.token_hex(16)

# Use the exact raw JSON bytes that will be sent.
# Claiming payment prevents an enrolled credit agent
# from silently running a new credit lookup.
body = {
    "personaId": "P01",
    "bureau": "transunion",
    "claimedRole": "payment",
}

raw = json.dumps(
    body,
    separators=(",", ":"),
    ensure_ascii=False,
)

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
    "Content-Type": "application/json",
    "X-Agent-Address": identity.address,
    "X-Agent-Timestamp": timestamp,
    "X-Agent-Nonce": nonce,
    "X-Agent-Signature": signature,
}

print("Agent address:", identity.address)
print("Sending signed request...")

try:
    response = httpx.post(
        "http://127.0.0.1:3000" + path,
        content=raw.encode("utf-8"),
        headers=headers,
        timeout=15,
    )

    print("HTTP:", response.status_code)
    data = response.json()
    print("DECISION:", data.get("decision"))
    print("REASON:", data.get("reason"))
    print("ERROR:", data.get("error"))
    print("DETAIL:", data.get("detail"))

except Exception as error:
    print("REQUEST ERROR:", type(error).__name__)
    print(str(error))
