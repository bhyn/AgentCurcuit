"""Safe, scoped patch: current AgentCircuit runner + panel, preserving other files.
Run from the repository root after extracting this ZIP into the project.
"""
from pathlib import Path
import ast
import os

ROOT = Path.cwd()
AGENTS = ROOT / "fetch_agents" / "ai_coordinated_agents.py"
PANEL = ROOT / "app" / "control" / "RunAgentPanel.tsx"
PLANNER = ROOT / "fetch_agents" / "ai_workflow_planner.py"
ROUTE = ROOT / "app" / "api" / "control" / "ai-provider" / "route.ts"


def substitute_once(source: str, old: str, new: str, name: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Could not safely patch {name}: expected one marker, found {count}.")
    return source.replace(old, new, 1)


def patch_agents(source: str) -> str:
    s = substitute_once(source,
        "from ai_handoff_server import choose_next_agent",
        "from ai_workflow_planner import choose_agent_action, get_ai_provider",
        "Python router import")
    start = s.find("def wants_x402_dry_run(goal: str) -> bool:")
    end = s.find("async def run_x402_dry_run(", start)
    if start < 0 or end < 0 or start >= end:
        raise RuntimeError("Expected the old keyword routing helpers; refusing to patch unknown code")
    s = s[:start] + s[end:]
    if s.count("routing = await choose_next_agent(") != 2:
        raise RuntimeError("Expected exactly two AI routing stages")
    s = s.replace("routing = await choose_next_agent(", "routing = await choose_agent_action(")
    s = substitute_once(s,
        '        ctx.logger.info(f"CRS PERSONA SELECTED: {persona_id} | bureau={bureau}")',
        '        ctx.logger.info(f"AI PROVIDER SELECTED: {get_ai_provider().upper()}")\n'
        '        ctx.logger.info(f"CRS PERSONA SELECTED: {persona_id} | bureau={bureau}")',
        "provider startup log")
    for before, after in [
        ('f"OLLAMA AI SELECTED: {next_agent}"', 'f"{routing[\'provider\'].upper()} AI SELECTED: {next_agent}"'),
        ('f"OLLAMA AI REASON: {routing[\'reason\']}"', 'f"{routing[\'provider\'].upper()} AI REASON: {routing[\'reason\']}"'),
        ('f"OLLAMA AFTER FRAUD: {next_agent}"', 'f"{routing[\'provider\'].upper()} AFTER FRAUD: {next_agent}"'),
        ('f"OLLAMA REASON: {routing[\'reason\']}"', 'f"{routing[\'provider\'].upper()} REASON: {routing[\'reason\']}"'),
    ]:
        s = substitute_once(s, before, after, "provider-aware logging")
    s = substitute_once(s,
        '        task_names = {\n            "fraud": "review_fraud",\n            "payment": payment_task_for_goal(USER_GOAL),\n        }\n\n',
        '', "remove keyword-based task choices")
    s = substitute_once(s, 'task=task_names[next_agent]', 'task=routing["task"]', "first task")
    s = substitute_once(s, 'task=payment_task_for_goal(USER_GOAL)', 'task=routing["task"]', "after-fraud task")
    s = s.replace("# 1. Credit checks the report, then asks Ollama", "# 1. Credit checks the report, then asks the selected AI model")
    s = s.replace("# Ollama decides what happens after Fraud.", "# The selected model decides what happens after Fraud.")
    ast.parse(s)
    if "payment_task_for_goal" in s or "wants_x402_dry_run" in s:
        raise RuntimeError("Old keyword task routing still exists")
    return s


def patch_panel(source: str) -> str:
    s = substitute_once(source,
        '  const [catalogError, setCatalogError] = useState("");',
        '''  const [catalogError, setCatalogError] = useState("");
  const [provider, setProvider] = useState<"gemini" | "ollama">("ollama");
  const [providerLoaded, setProviderLoaded] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [providerError, setProviderError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/control/ai-provider", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI provider settings unavailable");
        return response.json();
      })
      .then((data: { provider: "gemini" | "ollama"; geminiConfigured: boolean }) => {
        if (active) {
          setProvider(data.provider);
          setGeminiConfigured(Boolean(data.geminiConfigured));
          setProviderLoaded(true);
          setProviderError("");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setProviderError(error instanceof Error ? error.message : "AI model settings unavailable");
          setProviderLoaded(false);
        }
      });
    return () => { active = false; };
  }, []);''',
        "provider UI state")
    s = substitute_once(s,
        '      const response = await fetch(API, {\n        method: "POST",',
        '''      if (action === "start") {
        const choice = await fetch("/api/control/ai-provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        const chosen = await choice.json();
        if (!choice.ok) throw new Error(chosen.error || "Could not select AI model");
      }
      const response = await fetch(API, {
        method: "POST",''',
        "persist provider before starting agents")
    s = substitute_once(s,
        'Write a goal. Ollama selects the next agent; AgentCircuit controls access.',
        'Write a goal. Your selected AI plans agent tasks; AgentCircuit controls access.',
        "neutral UI subtitle")
    s = substitute_once(s,
        '''          <label htmlFor="agent-goal" className={s.taskLabel}>Your task</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#aebfdb", fontSize: 11 }}>
            CRS persona''',
        '''          <label htmlFor="agent-goal" className={s.taskLabel}>Your task</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#aebfdb", fontSize: 11 }}>
            AI model
            <select
              aria-label="AI planning model"
              value={provider}
              disabled={!providerLoaded || running || busy}
              onChange={(event) => setProvider(event.target.value as "gemini" | "ollama")}
              style={{ background: "#111d31", color: "#eaf2ff", border: "1px solid #455570", borderRadius: 8, padding: "5px 8px" }}
            >
              <option value="gemini" disabled={!geminiConfigured}>Gemini 3.8 Flash (API)</option>
              <option value="ollama">Ollama Qwen3 (local)</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#aebfdb", fontSize: 11 }}>
            CRS persona''',
        "provider dropdown")
    s = substitute_once(s,
        'disabled={busy || running || !goal.trim() || !selectionValid || !!catalogError}',
        'disabled={busy || running || !providerLoaded || (provider === "gemini" && !geminiConfigured) || !goal.trim() || !selectionValid || !!catalogError}',
        "run button guard")
    s = substitute_once(s,
        '        {personaIssue && <p className={`${s.feedback} ${s.feedbackError}`}>{personaIssue}</p>}',
        '''        {providerError && <p className={`${s.feedback} ${s.feedbackError}`}>{providerError}</p>}
        {!geminiConfigured && providerLoaded && <p className={s.feedback}>Gemini requires GEMINI_API_KEY in .env.local (restart Next.js after adding it). Ollama remains available.</p>}
        {personaIssue && <p className={`${s.feedback} ${s.feedbackError}`}>{personaIssue}</p>}''',
        "provider readiness notice")
    s = substitute_once(s,
        'Python · Fetch.ai · Ollama',
        'Python · Fetch.ai · {provider === "gemini" ? "Gemini" : "Ollama"}',
        "log provider label")
    return s


def main():
    for item in (AGENTS, PANEL, PLANNER, ROUTE):
        if not item.is_file():
            raise RuntimeError(f"Missing required file: {item}")
    original_agents = AGENTS.read_text(encoding="utf-8")
    original_panel = PANEL.read_text(encoding="utf-8")
    if "from ai_workflow_planner import choose_agent_action" in original_agents:
        print("The AI provider patch appears to be installed already. No changes made.")
        return
    new_agents = patch_agents(original_agents)
    new_panel = patch_panel(original_panel)
    backup_agents = AGENTS.with_name(AGENTS.name + ".before-ai-provider.bak")
    backup_panel = PANEL.with_name(PANEL.name + ".before-ai-provider.bak")
    if backup_agents.exists() or backup_panel.exists():
        raise RuntimeError("AI provider backup exists; refusing to overwrite it. Inspect/restore before retrying.")
    # Only write after BOTH in-memory patches and AST validation succeed.
    backup_agents.write_text(original_agents, encoding="utf-8")
    backup_panel.write_text(original_panel, encoding="utf-8")
    AGENTS.write_text(new_agents, encoding="utf-8")
    PANEL.write_text(new_panel, encoding="utf-8")
    ignore = ROOT / ".gitignore"
    if ignore.exists():
        content = ignore.read_text(encoding="utf-8")
        if ".agentcircuit-ai-provider.json" not in content:
            ignore.write_text(content.rstrip() + "\n\n# Local development AI provider selection\n.agentcircuit-ai-provider.json\n", encoding="utf-8")
    print("PATCH INSTALLED: Gemini / Ollama selector and structured AI task planning")
    print("BACKUPS:", backup_agents, backup_panel, sep="\n  ")
    print("No .env.local values were read or printed by the installer.")


if __name__ == "__main__":
    main()
