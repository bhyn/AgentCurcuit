"use client";

import { useEffect, useState } from "react";

type ActivityType =
  | "AI_DECISION" | "MESSAGE_SENT" | "MESSAGE_RECEIVED"
  | "SAFETY_OVERRIDE" | "WORKFLOW_COMPLETE" | "FRAUD_ASSESSMENT";

type Activity = {
  id: number;
  ts: number;
  type: ActivityType;
  agent: "credit" | "fraud" | "payment";
  detail: string;
  target?: "credit" | "fraud" | "payment";
  choice?: "fraud" | "payment" | "finish";
  // uAgents address whose signed request produced this event.
  address?: string;
  model?: string;
};

const labels: Record<ActivityType, string> = {
  AI_DECISION: "AI Decision",
  MESSAGE_SENT: "Message Sent",
  MESSAGE_RECEIVED: "Message Received",
  SAFETY_OVERRIDE: "Safety Override",
  WORKFLOW_COMPLETE: "Workflow Complete",
  FRAUD_ASSESSMENT: "Fraud Assessment",
};

const colors: Record<ActivityType, string> = {
  AI_DECISION: "text-violet-300 border-violet-500/40 bg-violet-500/10",
  MESSAGE_SENT: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  MESSAGE_RECEIVED: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  SAFETY_OVERRIDE: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  WORKFLOW_COMPLETE: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  FRAUD_ASSESSMENT: "text-rose-300 border-rose-500/40 bg-rose-500/10",
};

const RUN_COMMAND = "python fetch_agents/ai_agents_dashboard.py P01";

function shortAddress(address: string) {
  return address.length > 20 ? `${address.slice(0, 12)}…${address.slice(-6)}` : address;
}

export default function ActivityMonitor() {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/control/activity", { cache: "no-store" });
        if (!response.ok) throw new Error("Activity API unavailable");
        const data = (await response.json()) as { activity: Activity[] };
        if (active) { setActivity(data.activity ?? []); setError(false); }
      } catch {
        if (active) setError(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const decisions = activity.filter((a) => a.type === "AI_DECISION");
  const messages = activity.filter((a) => a.type === "MESSAGE_SENT");
  const latest = decisions[0];

  return (
    <section className="mt-8 space-y-4" aria-label="AI Agent Activity Monitor">
      <div>
        <h2 className="text-xl font-semibold">AI Agent Activity Monitor</h2>
        <p className="mt-1 text-sm text-slate-400">
          Signed Fetch.ai uAgents events and server-recorded AI decisions · refreshes every second
        </p>
      </div>
      {error && <p className="text-sm text-amber-400">Activity API is unavailable. Check the Next.js server.</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-sm text-slate-400">AI Decisions</p>
          <p className="mt-2 text-3xl font-bold text-violet-300">{decisions.length}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-sm text-slate-400">Agent Messages Sent</p>
          <p className="mt-2 text-3xl font-bold text-sky-300">{messages.length}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <p className="text-sm text-slate-400">Latest Route</p>
          <p className="mt-2 text-3xl font-bold capitalize text-white">{latest?.choice ?? "—"}</p>
        </div>
      </div>

      <div className="rounded-xl border border-violet-500/30 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">AI Decision Monitor</h3>
          <span className="rounded bg-violet-500/10 px-2 py-1 font-mono text-xs text-violet-300">{latest?.model || "No model yet"}</span>
        </div>
        {latest ? (
          <div className="mt-3 space-y-2">
            <p className="font-semibold text-violet-300">Route after policy: {latest.choice ?? "Unknown"}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{latest.detail}</p>
            <p className="text-xs text-slate-500">
              {new Date(latest.ts).toLocaleTimeString()}
              {latest.address && (
                <>
                  {" · Signer "}
                  <span className="font-mono text-slate-400" title={latest.address}>{shortAddress(latest.address)}</span>
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No AI decision yet. Run <code className="font-mono text-slate-300">{RUN_COMMAND}</code> to start.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h3 className="font-semibold">Agent Communication</h3>
        {messages.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {messages.slice(0, 8).map((message) => (
              <div key={message.id} className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm">
                <span className="capitalize text-sky-200">{message.agent}</span>
                <span className="px-2 text-slate-400">→</span>
                <span className="capitalize text-sky-200">{message.target ?? "unknown"}</span>
                <p className="mt-1 text-xs text-slate-400">{message.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Waiting for Fetch.ai uAgents messages.</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h3 className="font-semibold">Live Agent Timeline</h3>
        <div className="mt-4 space-y-3">
          {activity.length === 0 && (
            <p className="text-sm text-slate-400">
              No events yet. Events appear when the signed uAgents run: <code className="font-mono text-slate-300">{RUN_COMMAND}</code>
            </p>
          )}
          {activity.slice(0, 25).map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${colors[event.type] ?? "text-slate-300 border-slate-500/40 bg-slate-500/10"}`}>{labels[event.type] ?? event.type}</span>
                <span className="text-xs text-slate-500">{new Date(event.ts).toLocaleTimeString()}</span>
              </div>
              <p className="mt-2 text-sm font-medium capitalize text-white">{event.agent}{event.target ? ` → ${event.target}` : ""}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-300">{event.detail}</p>
              {(event.address || event.model) && (
                <p className="mt-1 text-xs text-slate-500">
                  {event.address && (
                    <>
                      {"Signer "}
                      <span className="font-mono text-slate-400" title={event.address}>{shortAddress(event.address)}</span>
                    </>
                  )}
                  {event.address && event.model && " · "}
                  {event.model && (
                    <>
                      {"Model "}
                      <span className="font-mono text-slate-400">{event.model}</span>
                    </>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">Development-only, in-memory demo. Agents sign every event they post with their uAgents key; AI decisions and policy overrides are recorded by AgentCircuit itself. Only summaries are stored, never credit reports or API keys. Reset clears this timeline.</p>
    </section>
  );
}
