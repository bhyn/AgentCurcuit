"""Safe patch for previously installed Gemini/Ollama AgentCircuit workflows."""

import ast
import re
from pathlib import Path

ROOT = Path.cwd()
AGENTS = ROOT / "fetch_agents" / "ai_coordinated_agents.py"
MONITOR = ROOT / "app" / "control" / "CompactActivityMonitor.tsx"
REPORTER = ROOT / "fetch_agents" / "ai_plan_reporter.py"
ROUTE = ROOT / "app" / "api" / "control" / "ai-plan" / "route.ts"


def replace_once(text: str, before: str, after: str, label: str) -> str:
    n = text.count(before)
    if n != 1:
        raise RuntimeError(f"Unexpected {label}: expected one marker, found {n}. No changes made.")
    return text.replace(before, after, 1)


def patch_agents(text: str) -> str:
    text = replace_once(
        text,
        "from activity_reporter import report_activity",
        "from activity_reporter import report_activity\nfrom ai_plan_reporter import report_ai_plan",
        "activity reporter import",
    )
    # This helper is deliberately best-effort: a temporary dashboard reporting
    # problem must never alter a genuine AI choice or the enforced policy.
    anchor = "async def record(ctx, role, kind, detail, target=None):"
    helper = '''async def record_ai_choice(ctx, plan, stage):
    try:
        await report_ai_plan(plan, stage=stage)
        ctx.logger.info(
            f"AI DECISION RECORDED | {plan['provider'].upper()} | "
            f"{stage} | {plan['next_agent']} / {plan['task']}"
        )
    except Exception as error:
        ctx.logger.warning(f"AI decision reporting failed: {error}")


'''
    text = replace_once(text, anchor, helper + anchor, "reporting helper")
    # The provider router's stage-specific call is immediately followed by the
    # local `next_agent = routing["next_agent"]` assignment at BOTH stages.
    for spaces, stage in ((8, "after_credit"), (12, "after_fraud")):
        anchor = " " * spaces + 'next_agent = routing["next_agent"]'
        matches = re.findall(r"(?m)^" + re.escape(anchor) + r"$", text)
        if len(matches) != 1:
            raise RuntimeError(f"Expected exactly one {stage} assignment, found {len(matches)}")
        text = re.sub(r"(?m)^" + re.escape(anchor) + r"$",
                      " " * spaces + f'await record_ai_choice(ctx, routing, "{stage}")\n\n' + anchor,
                      text, count=1)
    ast.parse(text)
    return text


def patch_monitor(text: str) -> str:
    text = replace_once(
        text,
        'actor: isAI ? "Ollama AI" : `${item.agent} agent`,',
        'actor: isAI ? (item.model ? `${item.model} AI` : "AI planner") : `${item.agent} agent`,',
        "model-aware timeline actor",
    )
    text = replace_once(
        text,
        'lastDecision ? lastDecision.detail : "Run a workflow to see how Ollama routes tasks."',
        'lastDecision ? lastDecision.detail : "Run a workflow to see Gemini or Ollama task decisions."',
        "AI provider placeholder",
    )
    marker = '<p className={s.glanceBig}>{lastDecision?.choice ?? "Waiting"}</p>'
    text = replace_once(text, marker, marker + '''
          {lastDecision?.model && (
            <p className={s.glanceDetail} title={lastDecision.model}>
              Model: {lastDecision.model}
            </p>
          )}''', "latest decision model")
    # Link the latest planner choice to any subsequent access-policy event for
    # the same agent. This is just a UI correlation, not an authorization verdict.
    marker = '  const lastMessage = messages[0];'
    text = replace_once(text, marker, marker + '''
  const latestPolicy = lastDecision && lastDecision.choice !== "finish"
    ? events.filter((item) =>
        item.agent.toLowerCase() === lastDecision.choice &&
        item.ts >= lastDecision.ts &&
        (item.status.startsWith("blocked") || item.status.startsWith("reused") || item.status === "executing")
      ).sort((a, b) => b.ts - a.ts)[0]
    : undefined;
  const latestPolicyOutcome = latestPolicy
    ? latestPolicy.status.startsWith("blocked") ? "BLOCK"
      : latestPolicy.status.startsWith("reused") ? "REUSE" : "ALLOW"
    : null;''', "latest policy correlation")
    marker = '  const x402 = inspectX402Log(runnerLog);'
    if marker in text:
        text = replace_once(text, marker, marker + '''
  const isX402Plan = Boolean(lastDecision?.detail.includes("task: x402_"));
  const verifiedOutcome = isX402Plan
    ? (x402.detected && ["ALLOWED", "BLOCKED", "CHECK FAILED"].includes(x402.policy)
      ? `x402 DRY RUN ${x402.policy} (NO PAYMENT)` : null)
    : latestPolicyOutcome;''', "x402 result linkage")
    marker = '''            {lastDecision ? lastDecision.detail : "Run a workflow to see Gemini or Ollama task decisions."}
          </p>'''
    text = replace_once(text, marker, marker + '''
          {lastDecision && (
            <p className={s.glanceDetail} title={latestPolicy?.detail}>
              AgentCircuit: {lastDecision.choice === "finish" ? "No access requested"
                : verifiedOutcome ?? "Awaiting verified access result"}
            </p>
          )}''', "policy result display")
    return text


def main():
    for path in (AGENTS, MONITOR, REPORTER, ROUTE):
        if not path.is_file():
            raise RuntimeError(f"Missing file: {path}. No changes made.")
    original_agents = AGENTS.read_text(encoding="utf-8")
    original_monitor = MONITOR.read_text(encoding="utf-8")
    if "from ai_plan_reporter import report_ai_plan" in original_agents:
        print("AI DECISION TRACKING ALREADY INSTALLED; no files changed")
        return
    if "from ai_workflow_planner import choose_agent_action" not in original_agents:
        raise RuntimeError("Gemini/Ollama planner not found. No changes made.")
    revised_agents = patch_agents(original_agents)
    revised_monitor = patch_monitor(original_monitor)
    back_agents = AGENTS.with_name(AGENTS.name + ".before-ai-decision-tracking.bak")
    back_monitor = MONITOR.with_name(MONITOR.name + ".before-ai-decision-tracking.bak")
    if back_agents.exists() or back_monitor.exists():
        raise RuntimeError("Existing tracking backup found: refusing to overwrite. No changes made.")
    # Only write after all matching and Python syntax validation succeeded.
    back_agents.write_text(original_agents, encoding="utf-8")
    back_monitor.write_text(original_monitor, encoding="utf-8")
    AGENTS.write_text(revised_agents, encoding="utf-8")
    MONITOR.write_text(revised_monitor, encoding="utf-8")
    print("AI DECISION TRACKING PATCH APPLIED")
    print("Gemini and Ollama task plans now report through a signed Credit Agent request.")
    print("Existing AgentCircuit policies and private environment settings were not changed.")
    print("Backups:", back_agents, back_monitor, sep="\n  ")


if __name__ == "__main__":
    main()
