"""Parsing of user requests and rendering of chat replies for the lead agent."""

import re
from typing import List, Optional

from common import BUREAU_LABELS, PERSONAS, BureauResult

_PERSONA_RE = re.compile(r"\bP(\d{2})\b", re.IGNORECASE)

FOOTER = (
    "_Sandbox test persona. This is a data summary, not a lending, approval or fraud decision._"
)


def extract_personas(text: str) -> List[str]:
    """Return the distinct persona ids mentioned in the text, in order (e.g. ['P17'])."""
    seen: List[str] = []
    for m in _PERSONA_RE.finditer(text):
        pid = f"P{m.group(1)}"
        if pid not in seen:
            seen.append(pid)
    return seen


def allowed_list() -> str:
    return ", ".join(f"{pid} ({name})" for pid, (name, _) in PERSONAS.items())


def help_text() -> str:
    return (
        "I run credit checks on sandbox test personas by delegating to my Credit agent, "
        "which pulls TransUnion, Equifax and Experian.\n\n"
        "Try: **Check credit for P17**\n\n"
        f"Allowed personas: {allowed_list()}."
    )


def not_allowed_text(requested: List[str]) -> str:
    if len(requested) > 1:
        return f"Please ask about one persona at a time (you mentioned {', '.join(requested)}).\n\nAllowed: {allowed_list()}."
    return f"{requested[0]} is not an allowed sandbox persona.\n\nAllowed: {allowed_list()}."


def timeout_text(persona_id: str, task_id: str, seconds: float) -> str:
    return (
        f"The credit lookup for {persona_id} did not finish within {seconds:g}s, so I have no result to report. "
        "This is a timeout, not a finding about the person. Please try again.\n\n"
        f"task_id: `{task_id}`"
    )


def unavailable_text(persona_id: str, task_id: str, reason: str) -> str:
    return (
        f"I could not run the credit lookup for {persona_id}: {reason}\n\n"
        f"task_id: `{task_id}`"
    )


def _bureau_line(r: BureauResult) -> str:
    label = BUREAU_LABELS.get(r.bureau, r.bureau)
    rid = f" · RequestID `{r.request_id}`" if r.request_id else ""
    if r.outcome == "scored":
        coll = f" · {r.collections_count} collection(s)" if r.collections_count else ""
        return f"- **{label}**: score **{r.score}** ({r.model_name}){coll}{rid}"
    if r.outcome == "no_score":
        return f"- **{label}**: file returned, no score. {r.detail}{rid}"
    if r.outcome == "no_hit":
        return f"- **{label}**: no file on record (no-hit){rid}"
    if r.outcome == "freeze":
        return f"- **{label}**: security freeze, file not released{rid}"
    if r.outcome == "deceased":
        return f"- **{label}**: deceased indicator, report withheld{rid}"
    return f"- **{label}**: lookup failed ({r.outcome}). {r.detail}{rid}"


def _observations(rs: List[BureauResult]) -> List[str]:
    notes: List[str] = []
    label = lambda r: BUREAU_LABELS.get(r.bureau, r.bureau)  # noqa: E731

    if any(r.outcome == "deceased" for r in rs):
        notes.append("Deceased indicator returned. Downstream lookups should stop and a person should review.")

    failed = [r for r in rs if r.outcome in ("crs_error", "auth_error", "http_error", "timeout", "unreachable")]
    if failed:
        names = ", ".join(f"{label(r)} ({r.outcome})" for r in failed)
        notes.append(f"{len(failed)} lookup(s) failed: {names}. Results are incomplete.")

    for r in rs:
        if r.outcome == "freeze":
            notes.append(f"{label(r)} is frozen. Missing data from a freeze is not a negative signal.")
        elif r.outcome == "no_hit" and any(x.outcome == "scored" for x in rs):
            notes.append(f"{label(r)} has no file while other bureaus do. Do not fill it in from the others.")

    scored = [r for r in rs if r.outcome == "scored"]
    if len(scored) >= 2:
        models = {r.model_name for r in scored}
        values = {r.score for r in scored}
        if len(values) > 1 and len(models) == 1:
            spread = max(values) - min(values)
            notes.append(f"Bureaus disagree on score by {spread} points using the same model; review manually.")
        elif len(values) > 1:
            notes.append("Scores differ, but they come from different models, so they are not directly comparable.")

    if any((r.collections_count or 0) > 0 for r in rs):
        who = ", ".join(label(r) for r in rs if (r.collections_count or 0) > 0)
        notes.append(f"Collections reported at {who}.")

    return notes


def render_report(persona_id: str, task_id: str, rs: List[BureauResult]) -> str:
    name, profile = PERSONAS.get(persona_id, (persona_id, ""))
    order = {b: i for i, b in enumerate(BUREAU_LABELS)}
    rs = sorted(rs, key=lambda r: order.get(r.bureau, 99))

    lines = [f"**Credit check · {persona_id} {name}** ({profile})", ""]
    lines += [_bureau_line(r) for r in rs]
    notes = _observations(rs)
    if notes:
        lines += ["", "**Observations**"] + [f"- {n}" for n in notes]
    lines += ["", f"task_id: `{task_id}`", FOOTER]
    return "\n".join(lines)
