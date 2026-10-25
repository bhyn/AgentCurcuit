"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { RecordedRun } from "@/lib/control/recorded-demo";
import RunAgentPanel from "./RunAgentPanel";
import RecordedDemoPanel from "./RecordedDemoPanel";
import CompactActivityMonitor from "./CompactActivityMonitor";
import ActivityMonitor from "./ActivityMonitor";
import s, { dashboardCss } from "./ControlDashboardStyles";

type DemoInfo = { mode: "live" } | { mode: "recorded"; runs: RecordedRun[] };

const REPLAY_STEP_MS = 700;

type RegisteredAgent = {
  address: string;
  role: string;
  name: string;
  enrolledAt: number;
};

type ControlEvent = {
  id: number;
  ts: number;
  agent: string;
  taskKey: string;
  status: string;
  detail: string;
  requestId?: string | null;
  address?: string;
};

type DecisionRecord = {
  personaId: string;
  final: "APPROVE" | "REVIEW" | "DECLINE";
  route: "fraud" | "payment" | "finish";
  overridden: boolean;
  rules: string[];
  proposal: { recommendation: string; reason: string } | null;
  model: string | null;
  ts: number;
  address: string;
};

type ControlState = {
  stats?: { requested: number; crsCalls: number; reused: number; blocked: number };
  agents?: RegisteredAgent[];
  decisions?: DecisionRecord[];
  events?: ControlEvent[];
};

const AGENT_PROFILES = [
  {
    role: "credit",
    title: "Credit Agent",
    subtitle: "Requests authorized credit reports",
    initials: "CR",
    avatar: s.avatarCredit,
  },
  {
    role: "fraud",
    title: "Fraud Agent",
    subtitle: "Rechecks data and reports results",
    initials: "FR",
    avatar: s.avatarFraud,
  },
  {
    role: "payment",
    title: "Payment Agent",
    subtitle: "Tests access permission boundaries",
    initials: "PY",
    avatar: s.avatarPayment,
  },
] as const;

function shortAddress(address: string) {
  return address.length > 22 ? `${address.slice(0, 12)}...${address.slice(-7)}` : address;
}

export default function ControlPage() {
  const [state, setState] = useState<ControlState | null>(null);
  const [stateError, setStateError] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [runIndex, setRunIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/control/demo", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { mode: "live" }))
      .then((data: DemoInfo) => {
        if (!active) return;
        setDemo(data.mode === "recorded" ? { mode: "recorded", runs: Array.isArray(data.runs) ? data.runs : [] } : { mode: "live" });
        if (data.mode === "recorded") setPlaying(true);
      })
      // An older server without this route can only be a live one.
      .catch(() => { if (active) setDemo({ mode: "live" }); });
    return () => { active = false; };
  }, []);

  const recordedRuns = demo?.mode === "recorded" ? demo.runs : null;
  const run = recordedRuns?.[runIndex];

  // Replay steps are the distinct moments at which the recorded run produced events.
  const moments = useMemo(() => {
    if (!run) return [];
    const times = [...run.activity.map((item) => item.ts), ...run.events.map((item) => item.ts)];
    return Array.from(new Set(times)).sort((a, b) => a - b);
  }, [run]);

  useEffect(() => {
    if (!playing) return;
    if (step >= moments.length) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((current) => current + 1), REPLAY_STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, step, moments.length]);

  const replay = useMemo(() => {
    if (!run) return null;
    const cutoff = step === 0 ? -Infinity : moments[step - 1];
    const events = run.events.filter((item) => item.ts <= cutoff);
    const lines = run.log.split("\n");
    const shownLines = moments.length === 0 ? lines.length : Math.round((lines.length * step) / moments.length);
    return {
      activity: run.activity.filter((item) => item.ts <= cutoff),
      events,
      stats: {
        requested: events.filter((item) => item.status === "executing" || item.status.startsWith("reused") || item.status.startsWith("blocked")).length,
        crsCalls: events.filter((item) => item.status === "executing").length,
        reused: events.filter((item) => item.status.startsWith("reused")).length,
        blocked: events.filter((item) => item.status.startsWith("blocked")).length,
      },
      log: lines.slice(0, shownLines).join("\n"),
    };
  }, [run, step, moments]);

  function selectRun(index: number) {
    setRunIndex(index);
    setStep(0);
    setPlaying(true);
  }

  useEffect(() => {
    // Live state only exists next to the local agents.
    if (demo?.mode !== "live") return;
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/control/state", { cache: "no-store" });
        if (!response.ok) throw new Error("State API unavailable");
        const next = (await response.json()) as ControlState;
        if (active) {
          setState(next);
          setStateError(false);
        }
      } catch {
        if (active) setStateError(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [demo?.mode]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailsOpen]);

  const recorded = demo?.mode === "recorded";
  const registered = recorded ? run?.agents ?? [] : state?.agents ?? [];
  const events = recorded ? replay?.events ?? [] : state?.events ?? [];
  const decisions = recorded ? [] : state?.decisions ?? [];
  const registeredCount = AGENT_PROFILES.filter((p) => registered.some((a) => a.role === p.role)).length;

  return (
    <main className={s.page}>
      <style>{dashboardCss}</style>
      <div className={s.shell}>
        <header className={s.header}>
          <div className={s.headerBrand}>
            <div className={s.logo} aria-hidden="true">A</div>
            <div>
              <div className={s.headTitle}>
                <h1 className={s.brandName}>AgentCircuit</h1>
                {demo && (
                  <span
                    className={s.localBadge}
                    style={recorded ? { color: "#f5c47d", background: "#483920", borderColor: "#87633b" } : undefined}
                  >
                    {recorded ? "RECORDED DEMO" : "LOCAL DEMO"}
                  </span>
                )}
              </div>
              <p className={s.tagline}>Autonomous AI chooses tasks. Fetch.ai agents collaborate. AgentCircuit enforces permissions.</p>
            </div>
          </div>
          <div className={s.headerLinks}>
            <Link href="/" className={s.softLink}>CRS Sandbox</Link>
            <button type="button" className={s.softButton} onClick={() => setDetailsOpen(true)}>Technical details</button>
          </div>
        </header>

        <section className={s.agentSection} aria-labelledby="agent-team-title">
          <div className={s.sectionMeta}>
            <h2 className={s.sectionName} id="agent-team-title">Meet your agents</h2>
            <p className={s.sectionNote}>
              {registeredCount} / 3 enrolled{recorded ? " in the recorded run" : ""} · Each request has a verified signing identity
            </p>
          </div>
          <div className={s.agentGrid}>
            {AGENT_PROFILES.map((profile) => {
              const enrolled = registered.find((agent) => agent.role === profile.role);
              return (
                <article className={s.agentCard} key={profile.role}>
                  <div className={`${s.avatar} ${profile.avatar}`}>{profile.initials}</div>
                  <div className={s.agentContent}>
                    <div className={s.agentTop}>
                      <h3 className={s.agentName}>{profile.title}</h3>
                      <span className={enrolled ? s.enrolled : s.notEnrolled}>{enrolled ? "Enrolled" : "Not enrolled"}</span>
                    </div>
                    <p className={s.agentDescription}>{profile.subtitle}</p>
                    <p className={s.agentAddress} title={enrolled?.address ?? "Not enrolled"}>
                      {enrolled ? shortAddress(enrolled.address) : "Identity pending — run agents to enroll"}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {demo?.mode === "live" && (
          <div className={s.workspace}>
            <RunAgentPanel />
            <CompactActivityMonitor
              stats={state?.stats}
              events={events}
              stateError={stateError}
            />
          </div>
        )}
        {recordedRuns && (
          <div className={s.workspace}>
            <RecordedDemoPanel
              runs={recordedRuns}
              runIndex={runIndex}
              onSelect={selectRun}
              step={step}
              totalSteps={moments.length}
              playing={playing}
              onReplay={() => selectRun(runIndex)}
              onShowAll={() => { setPlaying(false); setStep(moments.length); }}
              log={replay?.log ?? ""}
            />
            <CompactActivityMonitor
              stats={replay?.stats}
              events={events}
              stateError={false}
              recorded={{ activity: replay?.activity ?? [], log: replay?.log ?? "" }}
            />
          </div>
        )}
        <div className={s.footer}>
          <span>{recorded ? "AgentCircuit · Recorded demo · Run locally for live agents" : "AgentCircuit · Local sandbox · Signed Fetch.ai uAgents"}</span>
          <span>AI routing and data-access authorization are separate decisions</span>
        </div>
      </div>

      {detailsOpen && (
        <div
          className={s.modalBackdrop}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}
        >
          <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="technical-heading">
            <div className={s.modalHeader}>
              <div>
                <h2 id="technical-heading" className={s.modalTitle}>Technical details</h2>
                <p className={s.modalSubtitle}>Full signed agent activity, underwriting policy and request history</p>
              </div>
              <button className={s.softButton} onClick={() => setDetailsOpen(false)} type="button">Close ×</button>
            </div>
            <div className={s.modalContent}>
              <ActivityMonitor recordedActivity={recorded ? replay?.activity ?? [] : undefined} />
              <div className={s.advancedSection}>
                <h3 className={s.advancedTitle}>AI proposals vs AgentCircuit policy</h3>
                <p className={s.modalSubtitle}>Separate underwriting workflow. Natural-language routing uses a different decision API.</p>
                {decisions.length === 0 && <p className={s.advancedLine}>No underwriting decisions recorded yet.</p>}
                {decisions.map((decision) => (
                  <div className={s.advancedEntry} key={`${decision.personaId}-${decision.ts}`}>
                    <strong>{decision.personaId} · Policy {decision.final}</strong>
                    <p className={s.advancedLine}>AI proposed: {decision.proposal ? `${decision.proposal.recommendation} · ${decision.proposal.reason}` : "No AI proposal"}</p>
                    <p className={s.advancedLine}>{decision.overridden ? "Policy override" : "Policy outcome"} · {decision.model ?? "No model"}</p>
                  </div>
                ))}
              </div>
              <div className={s.advancedSection}>
                <h3 className={s.advancedTitle}>Signed access and policy log</h3>
                {events.length === 0 && <p className={s.advancedLine}>No access events yet.</p>}
                {events.slice(0, 35).map((event) => (
                  <div className={s.advancedEntry} key={event.id}>
                    <strong>{event.agent} · {event.status.replaceAll("-", " ")}</strong>
                    <p className={s.advancedLine}>{event.detail}</p>
                    <p className={s.modalSubtitle}>{new Date(event.ts).toLocaleTimeString()}{event.address ? ` · ${shortAddress(event.address)}` : ""}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
