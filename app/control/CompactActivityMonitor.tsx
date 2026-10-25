"use client";

import { useEffect, useMemo, useState } from "react";
import s from "./ControlDashboardStyles";

type AgentRole = "credit" | "fraud" | "payment";
type ActivityType = "AI_DECISION" | "MESSAGE_SENT" | "MESSAGE_RECEIVED" | "SAFETY_OVERRIDE" | "WORKFLOW_COMPLETE" | "FRAUD_ASSESSMENT";

type Activity = {
  id: number;
  ts: number;
  type: ActivityType;
  agent: AgentRole;
  detail: string;
  target?: AgentRole;
  choice?: "fraud" | "payment" | "finish";
  address?: string;
  model?: string;
};

type PolicyEvent = { id: number; ts: number; agent: string; status: string; detail: string };
type Stats = { requested: number; crsCalls: number; reused: number; blocked: number };
type RunnerSnapshot = { log?: string; status?: string };

type X402Snapshot = {
  detected: boolean;
  http: string;
  policy: string;
  settlement: string;
  policyColor: string;
};

// The runner's own log is the source of truth. A 402 challenge or an
// ALLOWED policy result is NOT proof that an x402 payment was settled.
function inspectX402Log(log: string): X402Snapshot {
  const detected = /X402\s*\|/i.test(log);
  const statusMatches = [...log.matchAll(/X402\s*\|\s*API HTTP STATUS:\s*(\d+)/gi)];
  const httpCode = statusMatches.at(-1)?.[1];
  const blocked = /X402\s*\|\s*POLICY BLOCKED\b/i.test(log);
  const allowed = /X402\s*\|\s*POLICY ALLOWED\b/i.test(log);
  const failed = /X402\s*\|\s*CHECK FAILED\b/i.test(log);
  return {
    detected,
    http: httpCode ? `HTTP ${httpCode}` : detected ? "Awaiting response" : "Not requested",
    policy: failed ? "CHECK FAILED" : blocked ? "BLOCKED" : allowed ? "ALLOWED" : "Pending",
    settlement: detected ? "NO PAYMENT · DRY RUN" : "Not requested",
    policyColor: failed || blocked ? "#fda4af" : allowed ? "#86efac" : "#afbed6",
  };
}

type TimelineEntry = {
  key: string;
  ts: number;
  actor: string;
  detail: string;
  label: string;
  icon: string;
  tone: "normal" | "blocked" | "allowed" | "message";
};

export default function CompactActivityMonitor({
  stats,
  events,
  stateError,
  recorded,
}: {
  stats?: Stats;
  events: PolicyEvent[];
  stateError: boolean;
  // A recorded run replaces the live APIs; nothing is polled.
  recorded?: { activity: Activity[]; log: string };
}) {
  const [liveActivity, setActivity] = useState<Activity[]>([]);
  const [activityError, setActivityError] = useState(false);
  const [liveRunnerLog, setRunnerLog] = useState("");
  const isRecorded = recorded !== undefined;
  const activity = recorded ? recorded.activity : liveActivity;
  const runnerLog = recorded ? recorded.log : liveRunnerLog;

  useEffect(() => {
    if (isRecorded) return;
    let active = true;
    async function refreshX402() {
      try {
        const response = await fetch("/api/control/run-agents", { cache: "no-store" });
        if (!response.ok) return;
        const snapshot = (await response.json()) as RunnerSnapshot;
        if (active) setRunnerLog(typeof snapshot.log === "string" ? snapshot.log : "");
      } catch {
        // Show the last known results while the runner is temporarily unavailable.
      }
    }
    void refreshX402();
    const timer = setInterval(() => void refreshX402(), 1500);
    return () => { active = false; clearInterval(timer); };
  }, [isRecorded]);


  useEffect(() => {
    if (isRecorded) return;
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/control/activity", { cache: "no-store" });
        if (!response.ok) throw new Error("Activity API unavailable");
        const result = (await response.json()) as { activity?: Activity[] };
        if (active) { setActivity(Array.isArray(result.activity) ? result.activity : []); setActivityError(false); }
      } catch {
        if (active) setActivityError(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [isRecorded]);

  const decisions = activity.filter((item) => item.type === "AI_DECISION");
  const messages = activity.filter((item) => item.type === "MESSAGE_SENT");
  const lastDecision = decisions[0];
  const lastMessage = messages[0];
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
    : null;
  const x402 = inspectX402Log(runnerLog);
  const isX402Plan = Boolean(lastDecision?.detail.includes("task: x402_"));
  const verifiedOutcome = isX402Plan
    ? (x402.detected && ["ALLOWED", "BLOCKED", "CHECK FAILED"].includes(x402.policy)
      ? `x402 DRY RUN ${x402.policy} (NO PAYMENT)` : null)
    : latestPolicyOutcome;

  const timeline = useMemo<TimelineEntry[]>(() => {
    const aiEvents: TimelineEntry[] = activity.map((item) => {
      const isAI = item.type === "AI_DECISION";
      const isMessage = item.type === "MESSAGE_SENT" || item.type === "MESSAGE_RECEIVED";
      const isComplete = item.type === "WORKFLOW_COMPLETE";
      const isFailed = isComplete && /^FAILED:/i.test(item.detail);
      const label = isAI ? item.choice ?? "Decision"
        : item.type === "MESSAGE_SENT" ? `→ ${item.target ?? "Agent"}`
        : item.type === "MESSAGE_RECEIVED" ? "Received"
        : isComplete ? (isFailed ? "Failed" : "Complete")
        : item.type === "SAFETY_OVERRIDE" ? "Override"
        : "Fraud review";
      return {
        key: `activity-${item.id}`,
        ts: item.ts,
        actor: isAI ? (item.model ? `${item.model} AI` : "AI planner") : `${item.agent} agent`,
        detail: item.detail,
        label,
        icon: isAI ? "AI" : isMessage ? "↗" : isFailed ? "!" : isComplete ? "✓" : "!",
        tone: isMessage ? "message" as const : isFailed ? "blocked" as const : isComplete ? "allowed" as const : "normal" as const,
      };
    });
    const policyEvents: TimelineEntry[] = events
      .filter((item) => item.status.startsWith("blocked") || item.status.startsWith("reused") || item.status === "executing")
      .map((item) => {
        const isBlocked = item.status.startsWith("blocked");
        const isReused = item.status.startsWith("reused");
        return {
          key: `policy-${item.id}`,
          ts: item.ts,
          actor: `${item.agent} agent`,
          detail: item.detail,
          label: isBlocked ? "BLOCK" : isReused ? "REUSE" : "ALLOW",
          icon: isBlocked ? "!" : "✓",
          tone: isBlocked ? "blocked" as const : "allowed" as const,
        };
      });
    return [...aiEvents, ...policyEvents].sort((a, b) => b.ts - a.ts).slice(0, 60);
  }, [activity, events]);

  const metrics = [
    { label: "AI decisions", value: decisions.length, className: s.toneViolet },
    { label: "Messages sent", value: messages.length, className: s.toneBlue },
    { label: "Cache reused", value: stats?.reused ?? 0, className: s.toneGreen },
    { label: "Access blocked", value: stats?.blocked ?? 0, className: s.toneRed },
  ];

  const badgeTone = (tone: TimelineEntry["tone"]) => tone === "blocked"
    ? s.badgeBlocked : tone === "allowed" ? s.badgeAllowed : tone === "message" ? s.badgeMessage : "";

  return (
    <section className={s.panel} aria-label="Live AI agent monitoring">
      <div className={s.monitorHeader}>
        <div>
          <p className={s.eyebrow}>{isRecorded ? "02 / Recorded oversight" : "02 / Live oversight"}</p>
          <h2 className={s.panelTitle}>Agent Activity</h2>
        </div>
        <span className={s.livePill}><span className={s.dot} />{isRecorded ? "Recorded run" : stateError || activityError ? "Sync issue" : "Live · 1s"}</span>
      </div>

      <div className={s.metricsGrid}>
        {metrics.map((metric) => (
          <div key={metric.label} className={s.metric}>
            <p className={s.metricLabel}>{metric.label}</p>
            <p className={`${s.metricValue} ${metric.className}`}>{metric.value}</p>
          </div>
        ))}
      </div>

      <div className={s.glanceGrid}>
        <div className={s.glanceCard}>
          <h3 className={s.glanceHeading}>Latest AI decision</h3>
          <p className={s.glanceBig}>{lastDecision?.choice ?? "Waiting"}</p>
          {lastDecision?.model && (
            <p className={s.glanceDetail} title={lastDecision.model}>
              Model: {lastDecision.model}
            </p>
          )}
          <p className={s.glanceDetail} title={lastDecision?.detail}>
            {lastDecision ? lastDecision.detail : "Run a workflow to see Gemini or Ollama task decisions."}
          </p>
          {lastDecision && (
            <p className={s.glanceDetail} title={latestPolicy?.detail}>
              AgentCircuit: {lastDecision.choice === "finish" ? "No access requested"
                : verifiedOutcome ?? "Awaiting verified access result"}
            </p>
          )}
        </div>
        <div className={s.glanceCard}>
          <h3 className={s.glanceHeading}>Agent communication</h3>
          {lastMessage ? (
            <>
              <p className={s.glanceBig}>{messages.length} messages sent</p>
              <p className={s.messageItem} title={lastMessage.detail}>
                <strong>{lastMessage.agent}</strong> → {lastMessage.target ?? "agent"}
              </p>
            </>
          ) : (
            <>
              <p className={s.glanceBig}>Waiting</p>
              <p className={s.glanceDetail}>Signed Fetch.ai messages will appear here.</p>
            </>
          )}
        </div>
      </div>

      {/* Show the x402 summary only when the live Fetch.ai workflow attempts
          an x402 step. Keep this section compact so monitoring remains visible. */}
      {x402.detected && (
        <div style={{ margin: "0 19px 12px", padding: "10px 12px", border: "1px solid #35455f", background: "#0b1728", borderRadius: 11, flex: "none" }} aria-label="x402 payment security">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: 12, color: "#dce7fd" }}>Payment Security · x402</strong>
            <span style={{ fontSize: 10, color: "#92a5bf" }}>{isRecorded ? "Recorded runner results" : "Live runner results"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, color: "#8fa5c1", fontSize: 10 }}>Challenge</p>
              <strong style={{ fontSize: 11, color: "#d4ddf2", overflowWrap: "anywhere" }}>{x402.http}</strong>
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, color: "#8fa5c1", fontSize: 10 }}>Policy</p>
              <strong style={{ fontSize: 11, color: x402.policyColor, overflowWrap: "anywhere" }}>{x402.policy}</strong>
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, color: "#8fa5c1", fontSize: 10 }}>Settlement</p>
              <strong style={{ fontSize: 10, color: "#d4ddf2", overflowWrap: "anywhere" }}>{x402.settlement}</strong>
            </div>
          </div>
        </div>
      )}

      <div className={s.timelineWrap}>
        <div className={s.timelineHeading}>
          <h3 className={s.timelineTitle}>{isRecorded ? "Recorded Activity Timeline" : "Live Activity Timeline"}</h3>
          <span className={s.timelineHint}>AI · messages · access policy</span>
        </div>
        <div className={s.timelineList}>
          {timeline.length === 0 ? (
            <p className={s.empty}>{isRecorded ? "Press Replay to step through the recorded run." : "No events yet. Run AI Agents to watch decisions and signed requests here."}</p>
          ) : timeline.map((entry) => (
            <article key={entry.key} className={s.timelineEvent}>
              <span className={s.timelineIcon} aria-hidden="true">{entry.icon}</span>
              <div className={s.timelineBody}>
                <p className={s.timelineActor}>{entry.actor}</p>
                <p className={s.timelineDetail}>{entry.detail}</p>
                <p className={s.timelineTime}>{new Date(entry.ts).toLocaleTimeString()}</p>
              </div>
              <span className={`${s.timelineBadge} ${badgeTone(entry.tone)}`}>{entry.label}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
