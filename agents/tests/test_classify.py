import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classify import classify  # noqa: E402


def gateway(file_status=None, scores=None, errors=None, http=200, alerts=None, deroga=None, rid="rid-1"):
    body = {
        # The real body echoes the SSN; classify must never copy it out.
        "requestData": {"ssn": "666701017"},
        "creditFiles": [{"creditFileDetail": {"creditFileResultStatusType": file_status}}] if file_status else [],
        "scores": scores or [],
        "responseAlertMessages": alerts or [],
        "summaries": {"derogatorySummary": deroga or {}},
    }
    return {"httpStatus": http, "requestId": rid, "ok": not errors, "errorMessages": errors or [], "body": body}


def test_scored_file_keeps_model_name():
    r = classify("experian", gateway("FileReturned", [{"modelName": "VantageScore 4.0", "scoreValue": "700"}],
                                     deroga={"collectionsCount": "1"}))
    assert (r.outcome, r.score, r.model_name, r.collections_count) == ("scored", 700, "VantageScore 4.0", 1)
    assert r.request_id == "rid-1"


def test_no_hit_is_not_freeze():
    assert classify("equifax", gateway("NoFileReturnedNoHit")).outcome == "no_hit"


def test_freeze_is_not_no_hit_even_with_null_score_entry():
    r = classify("transunion", gateway("NoFileReturnedCreditFreeze", [{"modelName": "FICO Score 9", "scoreValue": None}]))
    assert r.outcome == "freeze"
    assert r.score is None


def test_deceased_arrives_as_http_200_with_error_messages():
    err = [{"creditErrorMessageCode": "E1200", "creditErrorMessageText": "This is a deceased file"}]
    r = classify("transunion", gateway(errors=err))
    assert r.outcome == "deceased"


def test_other_crs_error_is_not_deceased():
    err = [{"creditErrorMessageCode": "E1005", "creditErrorMessageText": "User configuration not found"}]
    r = classify("experian", gateway(errors=err))
    assert r.outcome == "crs_error" and "E1005" in r.detail


def test_file_without_score_is_no_score():
    r = classify("transunion", gateway("FileReturned", [{"modelName": "X", "scoreValue": None, "noScoreReasonType": "ScoringNotAvailable"}]))
    assert r.outcome == "no_score" and "ScoringNotAvailable" in r.detail


def test_unexpected_file_status_is_flagged_not_guessed():
    assert classify("experian", gateway("SomethingNew")).outcome == "crs_error"


def test_http_401_is_auth_error():
    assert classify("experian", gateway(http=401)).outcome == "auth_error"


def test_gateway_login_failure_is_auth_error():
    assert classify("experian", {"error": "CRS login failed: HTTP 401"}).outcome == "auth_error"


def test_gateway_bad_request_is_http_error():
    assert classify("experian", {"error": "Unknown personaId"}).outcome == "http_error"


def test_unreadable_response():
    assert classify("experian", "oops").outcome == "http_error"


def test_ssn_never_leaks_into_result():
    r = classify("experian", gateway("FileReturned", [{"modelName": "M", "scoreValue": "700"}]))
    assert "666701017" not in r.model_dump_json()
