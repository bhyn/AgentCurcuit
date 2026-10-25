"use client";

import type { RecordedRun } from "@/lib/control/recorded-demo";
import s from "./ControlDashboardStyles";
import { readWorkflowOutcome } from "./RunAgentPanel";

function recordedDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Replays a run captured from the live local stack. Nothing executes here:
// the agents, AI decisions and AgentCircuit outcomes all come from that run.
export default function RecordedDemoPanel({
  runs,
  runIndex,
  onSelect,
  step,
  totalSteps,
  playing,
  onReplay,
  onShowAll,
  log,
}: {
  runs: RecordedRun[];
  runIndex: number;
  onSelect: (index: number) => void;
  step: number;
  totalSteps: number;
  playing: boolean;
  onReplay: () => void;
  onShowAll: () => void;
  log: string;
}) {
  const run = runs[runIndex];
  const finished = totalSteps > 0 && step >= totalSteps;
  const outcome = finished ? readWorkflowOutcome(log) : null;

  return (
    <section className={s.panel} aria-label="Recorded agent run">
      <div className={s.panelInner}>
        <div className={s.panelTitleRow}>
          <div>
            <p className={s.eyebrow}>01 / Recorded demo</p>
            <h2 className={s.panelTitle}>Recorded Agent Run</h2>
          </div>
          <span className={s.statusBadge}>{playing ? `REPLAYING ${step}/${totalSteps}` : "RECORDED"}</span>
        </div>
        <p className={s.panelSubtitle}>
          This public deployment cannot run the Python agents, so it replays workflows recorded from a live local run.
          Every event was produced by the real agents and AgentCircuit during that run; nothing executes on this server.
        </p>

        {!run ? (
          <p className={`${s.feedback} ${s.feedbackError}`}>No recorded runs are bundled with this deployment.</p>
        ) : (
          <>
            <p className={s.taskLabel}>Recorded scenarios</p>
            <div className={s.examples} role="group" aria-label="Recorded scenarios">
              {runs.map((item, index) => (
                <button
                  className={s.exampleButton}
                  key={item.id}
                  type="button"
                  aria-pressed={index === runIndex}
                  style={index === runIndex ? { borderColor: "#9c93ff", color: "#fff", background: "#282d50" } : undefined}
                  onClick={() => onSelect(index)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className={s.taskLabel}>Goal given to the agents</p>
            <div className={s.textarea} style={{ height: "auto", minHeight: 0 }}>{run.goal}</div>
            <div className={s.actions}>
              <button className={s.startButton} type="button" onClick={onReplay}>▶ Replay</button>
              <button className={s.stopButton} type="button" disabled={finished} onClick={onShowAll}>Show all</button>
              <span className={s.envLabel}>
                {run.provider === "gemini" ? "Gemini" : "Ollama"} · recorded {recordedDate(run.recordedAt)}
              </span>
            </div>
          </>
        )}
      </div>
      {outcome && (
        <div role="status" aria-live="polite" style={{
          margin: "0 19px 14px", padding: "12px 15px", borderRadius: 11,
          background: outcome.tone === "failed" ? "#44252f" : outcome.tone === "blocked" ? "#413525" : "#17372f",
          border: `1px solid ${outcome.tone === "failed" ? "#974e61" : outcome.tone === "blocked" ? "#87633b" : "#32745b"}`,
          color: "#f2f6ff",
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".02em" }}>
            {outcome.tone === "failed" ? "✕" : outcome.tone === "blocked" ? "⛨" : "✓"} {outcome.label} · RECORDED
          </div>
          <p style={{ margin: "5px 0 0", fontSize: 11, color: "#c8d4e8", lineHeight: 1.5 }}>
            {/* The live message mentions a still-running process, which does not apply to a replay. */}
            {outcome.label === "WORKFLOW COMPLETE" ? "The recorded workflow finished." : outcome.message}
          </p>
        </div>
      )}
      <div className={s.logsSection}>
        <div className={s.logsHeading}>
          <h3 className={s.logsTitle}>Recorded Agent Logs</h3>
          <span className={s.logsHint}>Python · Fetch.ai · {run?.provider === "gemini" ? "Gemini" : "Ollama"}</span>
        </div>
        <pre className={s.terminal} aria-live="off">{log || "Press Replay to step through the recorded agent logs."}</pre>
        <p className={s.logsFoot}>ALLOW / REUSE / BLOCK = access-control outcomes recorded during the run · x402 DRY RUN = no payment</p>
      </div>
    </section>
  );
}
