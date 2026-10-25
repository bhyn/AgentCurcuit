
import json
import re
import httpx

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen3:0.6b"


async def decide_action(message: str) -> dict:
    system_prompt = """
You are the ACTION ROUTER for AgentCircuit.

Choose one action:
- request_credit_report: The user asks to check,
  retrieve, access, or run a credit report.
- reply_only: The user asks a general question,
  requests an explanation, or says hello.

IMPORTANT:
- Support any sandbox persona ID such as P01,
  P02, P03, P04, etc.
- Support TransUnion, Experian, and Equifax.
- Do not assume that every ID exists.
- Do not substitute a different persona or bureau.
- You only choose an action.
- AgentCircuit independently validates requests
  and enforces permissions.
- Never claim you retrieved a credit report.

Examples:
"Explain credit scores" -> reply_only
"Check P01 using TransUnion" -> request_credit_report
"Check P02 using Experian" -> request_credit_report
"Get the P03 Equifax credit report" -> request_credit_report

Return ONLY JSON:
{
  "action": "request_credit_report",
  "reason": "Brief explanation",
  "reply": "Brief response"
}
"""

    payload = {
        "model": MODEL,
        "system": system_prompt,
        "prompt": message[:500],
        "stream": False,
        "format": "json",
        "think": False,
        "options": {"temperature": 0.1},
    }

    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            OLLAMA_URL, json=payload
        )
        response.raise_for_status()

    decision = json.loads(response.json()["response"])

    if not isinstance(decision, dict):
        raise ValueError("Invalid AI response")

    action = decision.get("action")

    if action not in (
        "request_credit_report",
        "reply_only",
    ):
        raise ValueError("Invalid AI action")

    reason = str(decision.get("reason", ""))[:300]
    reply = str(decision.get("reply", ""))[:500]

    if action == "reply_only":
        return {
            "action": "reply_only",
            "reason": reason,
            "reply": reply,
        }

    # Extract identifiers from the original request,
    # not from AI-generated text.
    personas = list(dict.fromkeys(
        re.findall(r"\bP\d+\b", message.upper())
    ))

    lower = message.lower()

    bureaus = []

    if "transunion" in lower or "trans union" in lower:
        bureaus.append("transunion")

    if "experian" in lower:
        bureaus.append("experian")

    if "equifax" in lower:
        bureaus.append("equifax")

    # Don't guess missing or ambiguous parameters.
    if len(personas) != 1 or len(bureaus) != 1:
        return {
            "action": "reply_only",
            "reason": "Missing or ambiguous request parameters",
            "reply": (
                "Please specify exactly one sandbox persona "
                "(for example P02) and one bureau "
                "(TransUnion, Experian, or Equifax)."
            ),
        }

    return {
        "action": "request_credit_report",
        "personaId": personas[0],
        "bureau": bureaus[0],
        "reason": reason,
        "reply": reply,
    }
