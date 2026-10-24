"""Client for the existing Next.js CRS gateway (POST /api/crs/credit).

The gateway owns the CRS credentials, token reuse and the exact persona request bodies.
This module only sends {personaId, bureau}.
"""

import os
import time

import httpx

from classify import classify
from common import BureauResult

GATEWAY_URL = os.getenv("CRS_GATEWAY_URL", "http://127.0.0.1:3000").rstrip("/")
GATEWAY_TIMEOUT_S = float(os.getenv("CRS_GATEWAY_TIMEOUT_S", "20"))


async def fetch_bureau(client: httpx.AsyncClient, persona_id: str, bureau: str) -> BureauResult:
    started = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        res = await client.post(
            f"{GATEWAY_URL}/api/crs/credit",
            json={"personaId": persona_id, "bureau": bureau},
            timeout=GATEWAY_TIMEOUT_S,
        )
    except httpx.TimeoutException:
        return BureauResult(
            bureau=bureau,
            outcome="timeout",
            detail=f"No answer from the CRS gateway within {GATEWAY_TIMEOUT_S:g}s",
            duration_ms=elapsed(),
        )
    except httpx.TransportError as err:
        return BureauResult(
            bureau=bureau,
            outcome="unreachable",
            detail=f"Cannot reach the CRS gateway at {GATEWAY_URL} ({type(err).__name__})",
            duration_ms=elapsed(),
        )

    try:
        payload = res.json()
    except ValueError:
        return BureauResult(
            bureau=bureau,
            outcome="http_error",
            detail=f"Gateway answered HTTP {res.status_code} with a non-JSON body",
            duration_ms=elapsed(),
        )
    return classify(bureau, payload, duration_ms=elapsed())
