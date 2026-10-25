
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

BASE = "http://127.0.0.1:3000"
PATH = "/api/control/agents"

AGENTS = [
    ("credit", "agentcircuit_credit", "CREDIT_AGENT_SEED_PHRASE"),
    ("fraud", "agentcircuit_fraud", "FRAUD_AGENT_SEED_PHRASE"),
    ("payment", "agentcircuit_gateway", "AGENT_SEED_PHRASE"),
]


def ensure_agents_enrolled():
    token = CONFIG.get("AGENTCIRCUIT_AGENT_TOKEN")

    if not token:
        raise RuntimeError("Missing enrollment token")

    print("=== AUTOMATIC AGENT ENROLLMENT ===", flush=True)

    with httpx.Client(timeout=30) as client:
        response = client.get(BASE + "/api/control/state")
        response.raise_for_status()

        registered = response.json().get("agents", [])

        if not isinstance(registered, list):
            raise RuntimeError("Invalid agent registry")

        for role, name, seed_key in AGENTS:
            seed = CONFIG.get(seed_key)

            if not seed:
                raise RuntimeError(f"Missing seed for {role}")

            identity = Identity.from_seed(seed, 0)

            existing = next(
                (
                    agent for agent in registered
                    if isinstance(agent, dict)
                    and str(agent.get("address", "")).lower()
                    == identity.address.lower()
                ),
                None,
            )

            if existing:
                if existing.get("role") != role:
                    raise RuntimeError(
                        f"{role}: Registered identity has "
                        "an unexpected role"
                    )

                print(
                    f"{role.upper()}: ALREADY REGISTERED",
                    flush=True,
                )
                continue

            body = {
                "role": role,
                "name": name,
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
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "X-Agent-Address": identity.address,
                "X-Agent-Timestamp": timestamp,
                "X-Agent-Nonce": nonce,
                "X-Agent-Signature": signature,
            }

            result = client.post(
                BASE + PATH,
                headers=headers,
                content=raw.encode("utf-8"),
            )

            if not result.is_success:
                raise RuntimeError(
                    f"{role}: enrollment HTTP "
                    f"{result.status_code}: "
                    f"{result.text[:200]}"
                )

            print(
                f"{role.upper()}: AUTO REGISTERED",
                flush=True,
            )

    print("=== ALL AGENTS READY ===", flush=True)


if __name__ == "__main__":
    ensure_agents_enrolled()
