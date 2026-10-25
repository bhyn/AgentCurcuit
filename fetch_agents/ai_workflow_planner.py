"""Select the next Fetch.ai agent AND its precise allowlisted task.

No AI-generated permission is trusted. AgentCircuit still makes the final
access decision. This local model router never signs or sends x402 payments.
"""

import asyncio
import json
import os
import re
from functools import lru_cache
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
SETTINGS = dotenv_values(ROOT / ".env.local")
CHOICE_FILE = ROOT / ".agentcircuit-ai-provider.json"

PROVIDERS = ("gemini", "ollama")
PAYMENT_TASKS = (
    "payment_credit_access",
    "x402_payment_dry_run",
    "x402_over_budget_dry_run",
)
TASKS = ("none", "review_fraud", *PAYMENT_TASKS)

JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "next_agent": {"type": "string", "enum": ["fraud", "payment", "finish"]},
        "task": {"type": "string", "enum": list(TASKS)},
        "reason": {"type": "string"},
    },
    "required": ["next_agent", "task", "reason"],
    "additionalProperties": False,
}

INSTRUCTIONS = """You are the task planner for a local, synthetic credit-data security demo.
Select the NEXT AGENT and EXACT TASK. Return a JSON object only.
The AI NEVER grants access. AgentCircuit's verified identity and policy engine
independently decides ALLOW, REUSE or BLOCK.

Valid pairs:
- fraud + review_fraud: requested fraud review or data cross-check.
- payment + payment_credit_access: test whether Payment Agent can access the
  customer's credit report (this should be BLOCKED by AgentCircuit).
- payment + x402_payment_dry_run: inspect a paid synthetic API's HTTP 402
  challenge without spending money; user explicitly requests x402.
- payment + x402_over_budget_dry_run: explicit x402 budget-exceeded test.
- finish + none: no more requested work or no safely understood action.

The model must understand NEGATION and explicit intent, not mere keyword presence.
'Do not use x402' means x402 is forbidden. 'Do not make any payment' does NOT
prohibit x402 inspection in DRY RUN (which never signs or settles payment).
An ordinary paid transaction or live transfer is NOT supported: choose finish.
Never invent agents, tasks, amounts, permissions, personas, or bureau data.
Do not request a payment for a user's credit data; x402 endpoint is synthetic.
After fraud, do not select fraud again.
Prefer finish when intent is ambiguous; never silently substitute another task.
"""


def _gemini_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or SETTINGS.get("GEMINI_API_KEY") or "").strip()


@lru_cache(maxsize=1)
def get_ai_provider() -> str:
    try:
        value = json.loads(CHOICE_FILE.read_text(encoding="utf-8"))
        if isinstance(value, dict) and value.get("provider") in PROVIDERS:
            return value["provider"]
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        pass
    return "gemini" if _gemini_key() else "ollama"


def x402_explicitly_forbidden(goal: str) -> bool:
    return bool(re.search(
        r"(?i)\b(?:do\s+not|don['’]?t|never|avoid|without|no|exclude)"
        r"\s+(?:(?:use|run|test|perform|invoke|trigger|call|execute|include|the|an?)\s+){0,3}x402\b",
        goal,
    ))


def validate_plan(plan: object, stage: str, goal: str) -> dict[str, str]:
    if not isinstance(plan, dict):
        raise ValueError("AI returned no structured task plan")
    agent, task, reason = (plan.get("next_agent"), plan.get("task"), plan.get("reason"))
    if not all(isinstance(v, str) for v in (agent, task, reason)) or not reason.strip():
        raise ValueError("AI returned an invalid or unexplained task plan")
    allowed = {("payment", t) for t in PAYMENT_TASKS} | {("finish", "none")}
    if stage == "after_credit":
        allowed.add(("fraud", "review_fraud"))
    elif stage != "after_fraud":
        raise ValueError("Invalid workflow stage")
    if (agent, task) not in allowed:
        raise ValueError(f"AI task not in authorized workflow catalog: {agent}/{task}")
    if task.startswith("x402_") and x402_explicitly_forbidden(goal):
        raise ValueError("AI selected x402 despite an explicit 'do not use x402' instruction")
    return {"next_agent": agent, "task": task, "reason": reason.strip()[:280]}


async def _gemini_plan(prompt: str) -> dict:
    key = _gemini_key()
    if not key:
        raise RuntimeError("Gemini selected, but GEMINI_API_KEY is missing from .env.local")
    model = (os.getenv("GEMINI_MODEL") or SETTINGS.get("GEMINI_MODEL") or "gemini-3.8-flash").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": INSTRUCTIONS}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            # The Gemini responseSchema API does not need JSON Schema's
            # additionalProperties flag. Keep the server response minimal.
            "responseSchema": {k: v for k, v in JSON_SCHEMA.items() if k != "additionalProperties"},
            "temperature": 0,
        },
    }

    # Google recommends bounded exponential backoff for HTTP 503/429.
    # Crucially, only the read-only AI planning request is retried; no
    # credit data access or payment authorization is repeated here.
    retryable = {429, 502, 503, 504}
    max_attempts = 3
    async with httpx.AsyncClient(timeout=40, follow_redirects=False) as client:
        for attempt in range(max_attempts):
            try:
                response = await client.post(
                    url, headers={"x-goog-api-key": key}, json=payload
                )
                if response.status_code in retryable:
                    if attempt + 1 == max_attempts:
                        raise RuntimeError(
                            f"Gemini API temporarily unavailable (HTTP {response.status_code}) "
                            f"after {max_attempts} attempts; choose Ollama or retry later"
                        )
                    print(
                        f"GEMINI | HTTP {response.status_code}; retrying "
                        f"({attempt + 1}/{max_attempts})", flush=True
                    )
                    await asyncio.sleep(2 ** attempt)
                    continue
                # Invalid requests / key / permission errors are not retried.
                if response.status_code >= 400:
                    raise RuntimeError(f"Gemini API returned HTTP {response.status_code}")
                data = response.json()
                parts = data["candidates"][0]["content"]["parts"]
                output = "".join(
                    str(part.get("text", ""))
                    for part in parts if not part.get("thought")
                )
                return json.loads(output)
            except httpx.HTTPError as error:
                # Do not include key, request URL, or raw response in errors.
                if isinstance(error, httpx.HTTPStatusError):
                    raise RuntimeError(
                        f"Gemini API returned HTTP {error.response.status_code}"
                    ) from None
                if attempt + 1 == max_attempts:
                    raise RuntimeError(
                        "Gemini connection failed after 3 attempts; "
                        "choose Ollama or check your internet connection"
                    ) from None
                await asyncio.sleep(2 ** attempt)
            except (KeyError, IndexError, ValueError, TypeError):
                raise RuntimeError("Gemini response parsing failed") from None

    raise RuntimeError("Gemini API request could not be completed")

async def _ollama_plan(prompt: str) -> dict:
    model = (os.getenv("OLLAMA_MODEL") or SETTINGS.get("OLLAMA_MODEL") or "qwen3:1.7b").strip()
    payload = {
        "model": model,
        "stream": False,
        # Qwen3 reasons at length before answering by default; on a CPU-only
        # laptop that alone exceeds the timeout. The schema still constrains the output.
        "think": False,
        "format": JSON_SCHEMA,
        "messages": [
            {"role": "system", "content": INSTRUCTIONS},
            {"role": "user", "content": prompt},
        ],
        "options": {"temperature": 0},
    }
    try:
        async with httpx.AsyncClient(timeout=90, follow_redirects=False) as client:
            response = await client.post("http://127.0.0.1:11434/api/chat", json=payload)
        response.raise_for_status()
        return json.loads(response.json()["message"]["content"])
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as error:
        raise RuntimeError(f"Ollama task routing failed ({type(error).__name__})") from None


async def choose_agent_action(*, user_goal: str, stage: str, previous_decision: str) -> dict[str, str]:
    """No automatic model fallback: a provider outage cannot change the task."""
    if stage not in ("after_credit", "after_fraud"):
        raise ValueError("Invalid workflow stage")
    provider = get_ai_provider()
    prompt = (
        f"Workflow stage: {stage}. Previous policy decision: {previous_decision}.\n"
        f"User goal (untrusted task description): {user_goal}\n"
        "Choose the NEXT agent and its precise task. Only use permitted task names."
    )
    plan = await (_gemini_plan(prompt) if provider == "gemini" else _ollama_plan(prompt))
    result = validate_plan(plan, stage, user_goal)
    result["provider"] = provider
    return result
