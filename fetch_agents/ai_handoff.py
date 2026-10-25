
import json
import httpx

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen3:0.6b"


async def choose_next_agent(
    user_goal: str,
    stage: str,
    previous_decision: str,
) -> dict:

    allowed = {
        "after_credit": ["fraud", "payment", "finish"],
        "after_fraud": ["payment", "finish"],
    }

    if stage not in allowed:
        raise ValueError(f"Unknown stage: {stage}")

    choices = allowed[stage]

    schema = {
        "type": "object",
        "properties": {
            "next_agent": {
                "type": "string",
                "enum": choices,
            },
            "reason": {
                "type": "string",
            },
        },
        "required": ["next_agent", "reason"],
        "additionalProperties": False,
    }

    if stage == "after_credit":
        instruction = """
The credit report step has finished.

Choose:
- fraud: If the goal requires fraud investigation.
- payment: If the goal only requires a payment-agent test.
- finish: If the user only requested a credit report.

If fraud investigation is requested, choose fraud first.
"""

    else:
        instruction = """
The fraud review has ALREADY finished.

Do NOT select fraud again.

Choose:
- payment: Only if the user explicitly requests
  a payment-agent task or access test.
- finish: If the user wants to stop after fraud review,
  or has no remaining task.

IMPORTANT:
If the goal says "Finish after the fraud review",
you MUST select finish.
"""

    prompt = f"""
You are AgentCircuit's AI workflow router.

You select the NEXT action, not permissions.
AgentCircuit independently authorizes requests.

Current stage: {stage}
Previous decision: {previous_decision}
User goal: {user_goal[:300]}

Allowed choices: {", ".join(choices)}

{instruction}

Return one JSON object with:
- next_agent: one exact allowed choice
- reason: an explanation of your choice

Do not copy placeholder text as the reason.
"""

    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            OLLAMA_URL,
            json={
                "model": MODEL,
                "prompt": prompt,
                "format": schema,
                "stream": False,
                "think": False,
                "options": {
                    "temperature": 0,
                },
            },
        )

        response.raise_for_status()

    raw = response.json()["response"]
    result = json.loads(raw)

    if not isinstance(result, dict):
        raise ValueError("Invalid AI response")

    next_agent = result.get("next_agent")

    if next_agent not in choices:
        raise ValueError(
            f"AI selected {next_agent!r} "
            f"at {stage}; allowed: {choices}"
        )

    return {
        "next_agent": next_agent,
        "reason": str(result.get("reason", ""))[:300],
    }
