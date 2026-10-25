"""AgentCircuit and Ollama helpers for the Fetch.ai demo agents.

Every AgentCircuit request is signed with the sending agent's own uAgents identity
(secp256k1), so the server decides permissions from the verified address instead of
a role name in the body. The operator token is only used for enrollment.
"""
import functools
import hashlib
import json
import logging
import os
import secrets
import ssl
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent

# The process environment overrides .env.local.
_FILE_CONFIG = dotenv_values(ROOT / ".env.local")


def _setting(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name) or _FILE_CONFIG.get(name) or default


AGENTCIRCUIT_URL = (_setting("AGENTCIRCUIT_URL") or "http://127.0.0.1:3000").rstrip("/")
OPERATOR_TOKEN = _setting("AGENTCIRCUIT_AGENT_TOKEN")
OLLAMA_URL = (_setting("OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = _setting("OLLAMA_MODEL") or "qwen3:0.6b"

# Each route verifies signatures against its own path constant.
ENROLL_PATH = "/api/control/agents"
CREDIT_PATH = "/api/control/agent-request"
DECISION_PATH = "/api/control/decision"
PAYMENT_PATH = "/api/control/payment"
ACTIVITY_PATH = "/api/control/activity"

BUREAUS = ("transunion", "equifax", "experian")
BUREAU_LABELS = {"transunion": "TransUnion", "equifax": "Equifax", "experian": "Experian"}


class AgentCircuitError(Exception):
    """AgentCircuit was unreachable or rejected the request."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class OllamaError(Exception):
    """Ollama was unreachable or returned unusable output."""


@functools.cache
def _tls() -> ssl.SSLContext:
    # httpx loads the CA bundle for every new client (about 0.3 s, blocking the event loop).
    return httpx.create_ssl_context()


def short_address(address: str) -> str:
    return f"{address[:12]}...{address[-6:]}"


def clip(text: object, limit: int) -> str:
    """Collapse whitespace and cut to `limit` UTF-16 code units (JavaScript string length)."""
    kept, units = [], 0
    for char in " ".join(str(text).split()):
        units += 2 if ord(char) > 0xFFFF else 1
        if units > limit:
            break
        kept.append(char)
    return "".join(kept)


def encode_body(payload: dict) -> bytes:
    """The exact bytes that are signed and sent."""
    return json.dumps(payload, separators=(",", ":")).encode()


def canonical_string(path: str, timestamp: str, nonce: str, body: bytes) -> str:
    """The AGENTCIRCUIT-V1 string an agent signs for one POST request."""
    return "\n".join([
        "AGENTCIRCUIT-V1",
        "POST",
        path,
        timestamp,
        nonce,
        hashlib.sha256(body).hexdigest(),
    ])


def signed_headers(agent, path: str, body: bytes) -> dict[str, str]:
    """Headers proving that `agent` sent exactly `body` to `path`, just now, once."""
    timestamp = str(time.time_ns() // 1_000_000)
    nonce = secrets.token_hex(16)
    signature = agent.sign(canonical_string(path, timestamp, nonce, body).encode("utf-8"))
    return {
        "Content-Type": "application/json",
        "X-Agent-Address": agent.address,
        "X-Agent-Timestamp": timestamp,
        "X-Agent-Nonce": nonce,
        "X-Agent-Signature": signature,
    }


class AgentCircuit:
    """Signed AgentCircuit calls on behalf of one uAgent.

    Uses only agent.address and agent.sign(bytes), so tests can pass a lightweight fake.
    """

    def __init__(self, agent, role: str, logger: logging.Logger | None = None,
                 base_url: str = AGENTCIRCUIT_URL, token: str | None = OPERATOR_TOKEN):
        self.agent = agent
        self.role = role
        self.logger = logger or logging.getLogger(f"agentcircuit.{role}")
        self.base_url = base_url.rstrip("/")
        self.token = token

    async def _post(self, path: str, payload: dict, timeout: float,
                    operator: bool = False) -> dict:
        """POST a signed request. Returns 200 bodies and 403 policy answers (with a decision)."""
        body = encode_body(payload)
        headers = signed_headers(self.agent, path, body)
        if operator:
            if not self.token:
                raise AgentCircuitError("AGENTCIRCUIT_AGENT_TOKEN is not set (needed to enroll)")
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with httpx.AsyncClient(timeout=timeout, verify=_tls()) as client:
                response = await client.post(self.base_url + path, content=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise AgentCircuitError(f"{path} timed out after {timeout:g} s") from exc
        except httpx.HTTPError as exc:
            raise AgentCircuitError(
                f"cannot reach AgentCircuit at {self.base_url} ({type(exc).__name__}); "
                "is the Next.js dev server running?"
            ) from exc

        try:
            data = response.json()
        except ValueError:
            data = None
        status = response.status_code
        if not isinstance(data, dict):
            raise AgentCircuitError(f"{path} returned HTTP {status} without a JSON object", status)
        if status == 200 or (status == 403 and "decision" in data):
            return data
        raise AgentCircuitError(
            f"{path} rejected the request (HTTP {status}): {data.get('error', 'no error message')}",
            status,
        )

    async def enroll(self, name: str) -> dict:
        """Bind this agent's address to its role: operator token plus proof of key possession."""
        return await self._post(
            ENROLL_PATH, {"role": self.role, "name": name}, timeout=15, operator=True
        )

    async def credit_report(self, persona_id: str, bureau: str,
                            claimed_role: str | None = None) -> dict:
        payload = {"personaId": persona_id, "bureau": bureau}
        if claimed_role is not None:
            payload["claimedRole"] = claimed_role
        return await self._post(CREDIT_PATH, payload, timeout=60)

    async def submit_decision(self, persona_id: str, proposal: dict | None,
                              model: str | None = None) -> dict:
        if proposal is not None:
            proposal = {
                "recommendation": proposal["recommendation"],
                "reason": clip(proposal["reason"], 600),
            }
        payload = {"personaId": persona_id, "proposal": proposal}
        if model:
            payload["model"] = clip(model, 64)
        return await self._post(DECISION_PATH, payload, timeout=15)

    async def request_payment(self, persona_id: str) -> dict:
        return await self._post(PAYMENT_PATH, {"personaId": persona_id}, timeout=15)

    async def activity(self, kind: str, detail: str, target: str | None = None,
                       choice: str | None = None, model: str | None = None) -> None:
        """Dashboard telemetry. Never raises: a display outage must not stop the workflow."""
        event = {"type": kind, "agent": self.role, "detail": clip(detail, 600)}
        if target:
            event["target"] = target
        if choice:
            event["choice"] = choice
        if model:
            event["model"] = clip(model, 64)
        try:
            await self._post(ACTIVITY_PATH, event, timeout=5)
        except Exception as exc:
            self.logger.warning(f"Activity display unavailable ({kind}): {exc}")


async def ollama_json(prompt: str, schema: dict) -> tuple[dict, str]:
    """Ask the local Ollama model for JSON matching `schema`. Returns (answer, model name)."""
    request = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "format": schema,
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_ctx": 1024, "num_predict": 160},
        "keep_alive": 0,
    }
    try:
        async with httpx.AsyncClient(timeout=180, verify=_tls()) as client:
            response = await client.post(f"{OLLAMA_URL}/api/generate", json=request)
    except httpx.TimeoutException as exc:
        raise OllamaError(f"Ollama timed out after 180 s ({OLLAMA_MODEL})") from exc
    except httpx.HTTPError as exc:
        raise OllamaError(f"cannot reach Ollama at {OLLAMA_URL} ({type(exc).__name__})") from exc

    try:
        data = response.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        data = {}
    if response.status_code != 200:
        raise OllamaError(
            f"Ollama HTTP {response.status_code}: {data.get('error', 'no error message')}"
        )
    try:
        answer = json.loads(data["response"])
    except (KeyError, TypeError, ValueError) as exc:
        raise OllamaError(
            f"{OLLAMA_MODEL} returned unusable output: {clip(data.get('response', ''), 120)!r}"
        ) from exc
    if not isinstance(answer, dict):
        raise OllamaError(f"{OLLAMA_MODEL} returned JSON that is not an object")
    return answer, str(data.get("model") or OLLAMA_MODEL)


def _error_text(error: dict) -> str:
    code = error.get("code")
    text = clip(error.get("text") or "", 100)
    if code and text:
        return f"{code} ({text})"
    return code or text


def _no_data_reason(result: dict) -> str:
    decision = result.get("decision")
    detail = clip(result.get("detail") or "", 120)
    if decision == "BLOCK":
        return f"blocked by AgentCircuit, {result.get('reason', 'policy')}: {detail}"
    if decision == "FAILED":
        return f"bureau request failed: {detail}"
    if decision == "ERROR":
        return f"AgentCircuit unavailable: {detail}"
    return "not returned"


def facts_text(summaries: dict[str, dict]) -> str:
    """One line per bureau, built only from AgentCircuit's summaries (never raw CRS data).

    `summaries` maps each bureau id to the AgentCircuit.credit_report() answer for it.
    """
    lines = []
    for bureau in BUREAUS:
        label = BUREAU_LABELS[bureau]
        result = summaries.get(bureau) or {}
        summary = result.get("summary")
        if not isinstance(summary, dict):
            lines.append(f"{label}: no data ({_no_data_reason(result)})")
            continue
        scores = [f"{s:g}" for s in summary.get("scores") or [] if isinstance(s, (int, float))]
        errors = [_error_text(e) for e in summary.get("errors") or [] if isinstance(e, dict)]
        errors = [e for e in errors if e]
        parts = [
            f"file status {summary.get('status') or 'not reported'}",
            f"score {', '.join(scores)}" if scores else "no score",
            f"errors {', '.join(errors)}" if errors else "no errors",
        ]
        http_status = summary.get("httpStatus")
        if isinstance(http_status, int) and not 200 <= http_status < 300:
            parts.append(f"HTTP {http_status}")
        lines.append(f"{label}: {'; '.join(parts)}")
    return "\n".join(lines)
