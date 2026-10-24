"""Message models and constants shared by the lead agent and the credit agent.

Both agents must import these exact classes: uAgents routes messages by model digest.
"""

from typing import List, Optional

from uagents import Model

# Sandbox test personas the agents may look up. The exact request bodies live in the
# Next.js gateway (lib/crs/personas.ts); agents only ever send the persona id.
PERSONAS = {
    "P01": ("Margaret Okafor", "Prime"),
    "P13": ("Kayla Brennan", "Synthetic identity / fraud"),
    "P14": ("Harold Pettigrew", "Deceased indicator"),
    "P15": ("Nicole Farragut", "Security freeze at one bureau"),
    "P17": ("Elena Castellanos", "Bureau divergence"),
}

BUREAUS = ("transunion", "equifax", "experian")
BUREAU_LABELS = {"transunion": "TransUnion", "equifax": "Equifax", "experian": "Experian"}

# Per-bureau outcomes. Keep them distinct: a freeze is not a no-hit, and neither is an error.
OUTCOMES = (
    "scored",  # file returned with a score
    "no_score",  # file returned but the bureau could not score it
    "no_hit",  # bureau has no file for this person
    "freeze",  # file exists but is under a security freeze
    "deceased",  # deceased indicator, report withheld
    "crs_error",  # CRS answered 200 with errorMessages or an unexpected file status
    "auth_error",  # gateway/CRS rejected our credentials
    "http_error",  # gateway answered with an unexpected HTTP status or body
    "timeout",  # no answer in time
    "unreachable",  # could not connect to the gateway
)


class BureauResult(Model):
    bureau: str
    outcome: str
    score: Optional[int] = None
    model_name: Optional[str] = None
    file_status: Optional[str] = None
    request_id: Optional[str] = None
    detail: str = ""
    collections_count: Optional[int] = None
    alert_count: int = 0
    duration_ms: Optional[int] = None


class CreditRequest(Model):
    task_id: str
    persona_id: str


class CreditResult(Model):
    task_id: str
    persona_id: str
    # "completed" = every bureau was attempted (individual bureaus may still have failed);
    # "rejected" = the request was refused before any lookup.
    status: str
    bureaus: List[BureauResult] = []
    error: Optional[str] = None
