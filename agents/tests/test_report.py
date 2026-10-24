import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import report  # noqa: E402
from common import BureauResult  # noqa: E402


def br(bureau, outcome, **kw):
    return BureauResult(bureau=bureau, outcome=outcome, **kw)


def test_extract_personas():
    assert report.extract_personas("Check credit for P17") == ["P17"]
    assert report.extract_personas("p01 and P17, again p01") == ["P01", "P17"]
    assert report.extract_personas("hello") == []
    assert report.extract_personas("P017 or XP01Y") == []


def test_p17_report_keeps_each_bureau_separate_and_does_not_decide():
    rs = [
        br("transunion", "scored", score=760, model_name="VantageScore 4.0", request_id="a"),
        br("equifax", "no_hit", request_id="b"),
        br("experian", "scored", score=700, model_name="VantageScore 4.0", collections_count=1, request_id="c"),
    ]
    text = report.render_report("P17", "t1", rs)
    assert "760" in text and "700" in text and "no file on record" in text
    assert "disagree on score by 60 points" in text
    assert "Do not fill it in" in text
    assert "approve" not in text.lower().replace("not a lending, approval", "")
    assert "t1" in text


def test_different_models_are_not_called_a_disagreement():
    rs = [
        br("transunion", "scored", score=790, model_name="FICO 9"),
        br("experian", "scored", score=700, model_name="VantageScore 4.0"),
    ]
    text = report.render_report("P01", "t", rs)
    assert "not directly comparable" in text and "disagree on score" not in text


def test_freeze_is_explained_as_not_negative():
    rs = [br("transunion", "freeze"), br("equifax", "scored", score=740, model_name="V"), br("experian", "scored", score=740, model_name="V")]
    text = report.render_report("P15", "t", rs)
    assert "security freeze" in text and "not a negative signal" in text


def test_failures_are_reported_as_incomplete_not_as_findings():
    rs = [br("transunion", "timeout", detail="slow"), br("equifax", "unreachable"), br("experian", "scored", score=700, model_name="V")]
    text = report.render_report("P01", "t", rs)
    assert "2 lookup(s) failed" in text and "incomplete" in text


def test_deceased_says_stop():
    rs = [br(b, "deceased") for b in ("transunion", "equifax", "experian")]
    assert "should stop" in report.render_report("P14", "t", rs)


def test_timeout_message_is_not_a_finding():
    assert "not a finding about the person" in report.timeout_text("P17", "t", 45)
