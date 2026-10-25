"""Signed, best-effort reporting of AI workflow plans to AgentCircuit.

This module reports a planner's already-validated output; it does not make an
authorization decision, sign a payment, or change the workflow's selected task.
"""

import hashlib
import json
import os
import secrets
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from uagents_core.identity import Identity

ROOT = Path(__file__).resolve().parent.parent
SETTINGS = dotenv_values(ROOT / ".env.local")
PATH = "/api/control/ai-plan"
API = "http://127.0.0.1:3000" + PATH


def _model_name(provider: str) -> str:
    if provider == "gemini":
        return (os.getenv("GEMINI_MODEL") or SETTINGS.get("GEMINI_MODEL") or "gemini-3.8-flash").strip()
    return (os.getenv("OLLAMA_MODEL") or SETTINGS.get("OLLAMA_MODEL") or "qwen3:1.7b").strip()


async def report_ai_plan(plan: dict, *, stage: str) -> None:
    seed = SETTINGS.get("CREDIT_AGENT_SEED_PHRASE")
    if not seed:
        raise RuntimeError("Credit Agent seed unavailable for signing AI plan")
    identity = Identity.from_seed(seed, 0)
    provider = plan["provider"]
    body = {
        "provider": provider,
        "model": _model_name(provider),
        "stage": stage,
        "next_agent": plan["next_agent"],
        "task": plan["task"],
        "reason": plan["reason"],
    }
    raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(16)
    digest = hashlib.sha256("\n".join((
        "AGENTCIRCUIT-V1", "POST", PATH, timestamp, nonce, hashlib.sha256(raw).hexdigest()
    )).encode("utf-8")).digest()
    headers = {
        "Content-Type": "application/json",
        "X-Agent-Address": identity.address,
        "X-Agent-Timestamp": timestamp,
        "X-Agent-Nonce": nonce,
        "X-Agent-Signature": identity.sign_digest(digest),
    }
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
        response = await client.post(API, content=raw, headers=headers)
    if response.status_code != 200:
        # Never log request bodies or credentials.
        raise RuntimeError(f"AI plan reporting returned HTTP {response.status_code}")
