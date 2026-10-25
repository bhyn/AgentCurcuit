"use client";

import { useEffect, useState } from "react";
import s from "./ControlDashboardStyles";

const API = "/api/control/run-agents";
const DEFAULT_GOAL =
  "First investigate identity fraud in P01 using TransUnion. " +
  "After fraud review, test whether the payment agent can access the credit report.";

const EXAMPLES = [
  { label: "Credit only", goal: "Only check the P01 TransUnion credit report. No other tasks are needed." },
  { label: "Fraud review", goal: "Investigate possible identity fraud in P01 using TransUnion. Finish after the fraud review." },
  { label: "Full security test", goal: DEFAULT_GOAL },
  {
    label: "x402 · ALLOW",
    goal: "Review P01's TransUnion report for fraud, then ask the Payment Agent to inspect the x402 paid synthetic API in DRY RUN mode. Do not make any payment.",
  },
  {
    label: "x402 · BLOCK (budget)",
    goal: "Review P01's TransUnion report for fraud, then test an x402 payment over budget with the Payment Agent in DRY RUN mode. Do not make any payment.",
  },
];

// The catalog is computed server-side from the actual bundled CRS fixtures.
// Do not enumerate P01-P20 in the browser without checking they are configured.
const PERSONA_REGEX = /\bP\d+\b/gi;

function personaIdsInGoal(goal: string): string[] {
  return Array.from(new Set((goal.toUpperCase().match(PERSONA_REGEX) || [])));
}

function changePersonaInGoal(goal: string, personaId: string): string {
  if (personaIdsInGoal(goal).length === 0) return `For ${personaId}, ${goal}`;
  return goal.replace(PERSONA_REGEX, personaId);
}

type RunState = { status: string; goal: string; log: string; error: string };

type WorkflowOutcome = { label: string; message: string; tone: "success" | "blocked" | "failed" };

// The Bureau stays online after a task finishes. Never infer completion from
// its process status alone; only an explicit terminal log marker counts.
export function readWorkflowOutcome(log: string): WorkflowOutcome | null {
  const lines = log.split(/\r?\n/).filter((line) =>
    /WORKFLOW (?:COMPLETE|FAILED):/.test(line)
  );
  const last = lines[lines.length - 1] ?? "";
  if (!last) return null;
  if (/WORKFLOW FAILED:|WORKFLOW COMPLETE:\s*FAILED:/.test(last)) {
    return { label: "WORKFLOW FAILED", message: "The workflow encountered an error. Check the Live Agent Logs below.", tone: "failed" };
  }
  if (/x402 demo policy blocked payment/i.test(last)) {
    return { label: "WORKFLOW COMPLETE · PAYMENT BLOCKED", message: "AgentCircuit blocked the x402 payment request under the demo payment policy. No payment was made.", tone: "blocked" };
  }
  if (/Unauthorized access blocked/i.test(last)) {
    return { label: "WORKFLOW COMPLETE · ACCESS BLOCKED", message: "AgentCircuit blocked unauthorized credit data access. The workflow has finished.", tone: "blocked" };
  }
  if (/x402 policy allowed/i.test(last)) {
    return { label: "WORKFLOW COMPLETE · X402 DRY RUN", message: "The HTTP 402 challenge and demo policy check completed. No wallet signature or payment occurred.", tone: "success" };
  }
  return { label: "WORKFLOW COMPLETE", message: "The workflow has finished. The agent process is still running.", tone: "success" };
}

export default function RunAgentPanel() {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [state, setState] = useState<RunState>({ status: "idle", goal: "", log: "", error: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [personas, setPersonas] = useState<string[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState("");
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
  }, []);

  useEffect(() => {
    let active = true;
    async function loadPersonas() {
      try {
        const response = await fetch("/api/control/personas", { cache: "no-store" });
        if (!response.ok) throw new Error(`CRS persona catalog unavailable (HTTP ${response.status})`);
        const data = await response.json();
        if (!Array.isArray(data.personas) || !data.personas.every((id: unknown) => typeof id === "string")) {
          throw new Error("Invalid CRS persona catalog response");
        }
        if (active) {
          setPersonas(data.personas);
          setCatalogError("");
          setCatalogLoaded(true);
        }
      } catch (error) {
        if (active) {
          setCatalogError(error instanceof Error ? error.message : "Could not load CRS personas");
          setCatalogLoaded(true);
        }
      }
    }
    void loadPersonas();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(API, { cache: "no-store" });
        if (!response.ok) throw new Error("Agent runner unavailable");
        const result = (await response.json()) as RunState;
        if (active) { setState(result); setConnectionError(false); }
      } catch {
        if (active) setConnectionError(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const mentionedPersonas = personaIdsInGoal(goal);
  const selectedPersona = mentionedPersonas.length === 1 ? mentionedPersonas[0] : "P01";
  const selectionValid = mentionedPersonas.length <= 1 && personas.includes(selectedPersona);
  const personaIssue = mentionedPersonas.length > 1
    ? "Specify only one persona ID per workflow."
    : !catalogLoaded ? "Loading CRS sandbox personas..."
    : catalogError || !selectionValid
      ? catalogError || `${selectedPersona} is not configured in the local CRS sandbox fixtures.`
      : "";
  const selectedBureau = (goal.match(/\b(transunion|equifax|experian)\b/i) || [])[0] || "TransUnion";

  async function control(action: "start" | "stop") {
    if (action === "start" && (!selectionValid || !!catalogError)) {
      setMessage(personaIssue || "Select a valid CRS sandbox persona.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (action === "start") {
        const choice = await fetch("/api/control/ai-provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        const chosen = await choice.json();
        if (!choice.ok) throw new Error(chosen.error || "Could not select AI model");
      }
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, goal }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request failed");
      setMessage(action === "start" ? "Agent process started. Check the live results below." : "Stopping agents...");
      setState((prev) => ({
        ...prev,
        status: result.status,
        goal: action === "start" ? goal : prev.goal,
        log: action === "start" ? "" : prev.log,
        error: action === "start" ? "" : prev.error,
      }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  const running = state.status === "running" || state.status === "stopping";
  const outcome = readWorkflowOutcome(state.log);
  const badgeClass = outcome?.tone === "failed" || state.status === "error"
    ? s.statusError : outcome ? s.statusRunning : state.status === "running" ? s.statusRunning : "";

  return (
    <section className={s.panel} aria-label="Run your AI agents">
      <div className={s.panelInner}>
        <div className={s.panelTitleRow}>
          <div>
            <p className={s.eyebrow}>01 / Interactive demo</p>
            <h2 className={s.panelTitle}>Run AI Agents</h2>
          </div>
          <span className={`${s.statusBadge} ${badgeClass}`}>{outcome ? (outcome.tone === "failed" ? "TASK FAILED" : "TASK DONE") : state.status.toUpperCase()}</span>
        </div>
        <p className={s.panelSubtitle}>Write a goal. Your selected AI plans agent tasks; AgentCircuit controls access.</p>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="agent-goal" className={s.taskLabel}>Your task</label>
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
            CRS persona
            <select
              aria-label="CRS sandbox persona"
              disabled={running || busy || !catalogLoaded || !!catalogError || personas.length === 0}
              value={personas.includes(selectedPersona) ? selectedPersona : ""}
              onChange={(event) => setGoal((previous) => changePersonaInGoal(previous, event.target.value))}
              style={{ background: "#111d31", color: "#eaf2ff", border: "1px solid #455570", borderRadius: 8, padding: "5px 8px", minWidth: 82 }}
            >
              {!personas.includes(selectedPersona) && <option value="">Select</option>}
              {personas.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
        </div>
        <textarea
          id="agent-goal"
          className={s.textarea}
          value={goal}
          maxLength={500}
          onChange={(event) => setGoal(event.target.value)}
          disabled={running}
        />
        <div className={s.examples}>
          {EXAMPLES.map((example) => (
            <button
              className={s.exampleButton}
              key={example.label}
              type="button"
              disabled={busy || running}
              onClick={() => setGoal(changePersonaInGoal(example.goal, selectedPersona))}
            >
              {example.label}
            </button>
          ))}
        </div>
        <div className={s.actions}>
          <button className={s.startButton} type="button" disabled={busy || running || !providerLoaded || (provider === "gemini" && !geminiConfigured) || !goal.trim() || !selectionValid || !!catalogError} onClick={() => void control("start")}>▶ Run AI Agents</button>
          <button className={s.stopButton} type="button" disabled={busy || state.status !== "running"} onClick={() => void control("stop")}>Stop</button>
          <span className={s.envLabel}>{selectedPersona} · {selectedBureau} sandbox · {personas.length} configured</span>
        </div>
        {providerError && <p className={`${s.feedback} ${s.feedbackError}`}>{providerError}</p>}
        {!geminiConfigured && providerLoaded && <p className={s.feedback}>Gemini requires GEMINI_API_KEY in .env.local (restart Next.js after adding it). Ollama remains available.</p>}
        {personaIssue && <p className={`${s.feedback} ${s.feedbackError}`}>{personaIssue}</p>}
        {catalogLoaded && !catalogError && personas.length < 20 && (
          <p className={s.feedback}>Only {personas.length} of the documented 20 sandbox personas have local fixtures. The remaining IDs require their official CRS request bodies.</p>
        )}
        {message && !outcome && <p className={s.feedback}>{message}</p>}
        {(state.error || connectionError) && <p className={`${s.feedback} ${s.feedbackError}`}>{state.error || "Runner connection temporarily unavailable."}</p>}
      </div>
      {outcome && (
        <div role="status" aria-live="polite" style={{
          margin: "0 19px 14px", padding: "12px 15px", borderRadius: 11,
          background: outcome.tone === "failed" ? "#44252f" : outcome.tone === "blocked" ? "#413525" : "#17372f",
          border: `1px solid ${outcome.tone === "failed" ? "#974e61" : outcome.tone === "blocked" ? "#87633b" : "#32745b"}`,
          color: "#f2f6ff",
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".02em" }}>
            {outcome.tone === "failed" ? "✕" : outcome.tone === "blocked" ? "⛨" : "✓"} {outcome.label}
          </div>
          <p style={{ margin: "5px 0 0", fontSize: 11, color: "#c8d4e8", lineHeight: 1.5 }}>
            {outcome.message}
            {running ? " Click Stop before starting another workflow." : ""}
          </p>
        </div>
      )}
      <div className={s.logsSection}>
        <div className={s.logsHeading}>
          <h3 className={s.logsTitle}>Live Agent Logs</h3>
          <span className={s.logsHint}>Python · Fetch.ai · {provider === "gemini" ? "Gemini" : "Ollama"}</span>
        </div>
        <pre className={s.terminal} aria-live="off">{state.log || "Ready. Start a workflow to see signed requests and AI decisions."}</pre>
        <p className={s.logsFoot}>ALLOW / REUSE / BLOCK = access-control outcomes · WORKFLOW COMPLETE = task finished · x402 DRY RUN = no payment</p>
      </div>
    </section>
  );
}
