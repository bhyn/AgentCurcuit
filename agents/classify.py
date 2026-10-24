"""Turn one gateway response into a BureauResult.

The gateway (Next.js /api/crs/credit) wraps the raw CRS reply as
{httpStatus, requestId, ok, errorMessages, body}. CRS answers HTTP 200 even for
failures, so the outcome comes from errorMessages and the credit file status.

The raw body echoes the full SSN in `requestData`. Nothing from it is copied out.
"""

from typing import Any, Optional

from common import BureauResult


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def classify(bureau: str, resp: Any, duration_ms: Optional[int] = None) -> BureauResult:
    def result(outcome: str, detail: str, **kw: Any) -> BureauResult:
        return BureauResult(bureau=bureau, outcome=outcome, detail=detail, duration_ms=duration_ms, **kw)

    if not isinstance(resp, dict):
        return result("http_error", "Gateway returned an unreadable response")

    request_id = resp.get("requestId")

    # The gateway itself failed (bad input or it could not reach/log in to CRS).
    if "httpStatus" not in resp:
        message = str(resp.get("error", "Gateway error"))
        if "login" in message.lower():
            return result("auth_error", message)
        return result("http_error", message)

    http_status = resp.get("httpStatus")
    if http_status == 401:
        return result("auth_error", "CRS rejected the credentials or token (HTTP 401)", request_id=request_id)
    if not isinstance(http_status, int) or not 200 <= http_status < 300:
        return result("http_error", f"CRS answered HTTP {http_status}", request_id=request_id)

    body = resp.get("body") or {}
    errors = resp.get("errorMessages") or body.get("errorMessages") or []
    if errors:
        first = errors[0] or {}
        code = first.get("creditErrorMessageCode", "?")
        text = str(first.get("creditErrorMessageText", ""))
        if code == "E1200" or "deceased" in text.lower():
            return result("deceased", f"{code}: deceased indicator, report withheld", request_id=request_id)
        return result("crs_error", f"{code}: {text[:160]}", request_id=request_id)

    files = body.get("creditFiles") or []
    detail = (files[0] or {}).get("creditFileDetail") or {} if files else {}
    file_status = detail.get("creditFileResultStatusType")
    alert_count = len(body.get("responseAlertMessages") or [])
    common = dict(file_status=file_status, request_id=request_id, alert_count=alert_count)

    if file_status == "NoFileReturnedCreditFreeze":
        return result("freeze", "Security freeze: this bureau did not release the file", **common)
    if file_status == "NoFileReturnedNoHit":
        return result("no_hit", "No file on record at this bureau", **common)
    if file_status != "FileReturned":
        return result("crs_error", f"Unexpected file status: {file_status}", **common)

    deroga = (body.get("summaries") or {}).get("derogatorySummary") or {}
    collections = _as_int(deroga.get("collectionsCount"))

    scores = body.get("scores") or []
    for s in scores:
        value = _as_int(s.get("scoreValue"))
        if value is not None:
            return result(
                "scored",
                "Score returned",
                score=value,
                model_name=s.get("modelName"),
                collections_count=collections,
                **common,
            )

    reason = next((s.get("noScoreReasonType") for s in scores if s.get("noScoreReasonType")), None)
    return result(
        "no_score",
        f"File returned without a score ({reason or 'no reason given'})",
        collections_count=collections,
        **common,
    )
