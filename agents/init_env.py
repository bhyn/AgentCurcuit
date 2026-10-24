"""Create agents/.env with fresh random seeds and the matching agent addresses.

Run once:  python init_env.py
Existing values are never overwritten. Seeds are written to .env and never printed.
"""

import os
import secrets
from pathlib import Path

from uagents.crypto import Identity

ENV_PATH = Path(__file__).with_name(".env")


def read_env() -> dict:
    values = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip('"')
    return values


def main():
    env = read_env()
    added = []

    for seed_key in ("LEAD_AGENT_SEED", "CREDIT_AGENT_SEED"):
        if not env.get(seed_key):
            env[seed_key] = secrets.token_hex(24)
            added.append(seed_key)

    lead_addr = Identity.from_seed(env["LEAD_AGENT_SEED"], 0).address
    credit_addr = Identity.from_seed(env["CREDIT_AGENT_SEED"], 0).address
    # Addresses are derived values, so they always follow the seeds.
    env["LEAD_AGENT_ADDRESS"] = lead_addr
    env["CREDIT_AGENT_ADDRESS"] = credit_addr

    existing = ENV_PATH.read_text() if ENV_PATH.exists() else ""
    lines = [l for l in existing.splitlines() if l.split("=", 1)[0].strip() not in env]
    lines += [f'{k}="{v}"' for k, v in env.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n")
    os.chmod(ENV_PATH, 0o600)

    print(f"Wrote {ENV_PATH.name} (new seeds: {', '.join(added) or 'none, kept existing'})")
    print(f"LEAD_AGENT_ADDRESS   = {lead_addr}")
    print(f"CREDIT_AGENT_ADDRESS = {credit_addr}")


if __name__ == "__main__":
    main()
