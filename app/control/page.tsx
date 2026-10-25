"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RunAgentPanel from "./RunAgentPanel";
import CompactActivityMonitor from "./CompactActivityMonitor";
import ActivityMonitor from "./ActivityMonitor";
import s, { dashboardCss } from "./ControlDashboardStyles";

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

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailsOpen]);

  const registered = state?.agents ?? [];
  const events = state?.events ?? [];
  const decisions = state?.decisions ?? [];
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
                <span className={s.localBadge}>LOCAL DEMO</span>
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
            <p className={s.sectionNote}>{registeredCount} / 3 enrolled · Each request has a verified signing identity</p>
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

        <div className={s.workspace}>
          <RunAgentPanel />
          <CompactActivityMonitor
            stats={state?.stats}
            events={events}
            stateError={stateError}
          />
        </div>
        <div className={s.footer}>
          <span>AgentCircuit · Local sandbox · Signed Fetch.ai uAgents</span>
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
              <ActivityMonitor />
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
