"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Ev = {
  id: number;
  ts: number;
  agent: string;
  taskKey: string;
  status: string;
  detail: string;
  requestId?: string | null;
  cost?: number;
};
type State = {
  budget: { total: number; spent: number; reserved: number };
  stats: { requested: number; crsCalls: number; reused: number; blocked: number };
  events: Ev[];
};

const STATUS_STYLE: Record<string, string> = {
  executing: "text-blue-600",
  completed: "text-green-600",
  "reused-cache": "text-teal-600",
  "reused-inflight": "text-teal-600",
  "blocked-budget": "text-red-600",
  "blocked-permission": "text-red-600",
  failed: "text-red-600",
};

export default function ControlPage() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/control/state");
    if (res.ok) setState(await res.json());
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  async function run(scenario: string) {
    setBusy(scenario);
    await fetch("/api/control/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    await refresh();
    setBusy(null);
  }

  const b = state?.budget;
  const s = state?.stats;
  const pct = b ? Math.min(100, ((b.spent + b.reserved) / b.total) * 100) : 0;

  return (
    <main className="mx-auto max-w-5xl p-8 font-sans">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">AgentCircuit · Control tower</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          CRS check
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Agents run independently. The control layer de-duplicates pulls, reserves budget before spending, and enforces
        permissions. Costs are simulated; the CRS sandbox is free.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => run("dedup")}
          disabled={busy !== null}
          className="rounded-md border border-neutral-300 px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <div className="font-medium">Scenario 1 · Same applicant, 3 agents</div>
          <div className="text-xs text-neutral-500">Credit, Fraud and Payment all ask about P01 at once</div>
        </button>
        <button
          onClick={() => run("budget")}
          disabled={busy !== null}
          className="rounded-md border border-neutral-300 px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <div className="font-medium">Scenario 2 · Budget stress</div>
          <div className="text-xs text-neutral-500">15 pulls fired at once against a $10 budget</div>
        </button>
        <button
          onClick={() => run("reset")}
          disabled={busy !== null}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Reset
        </button>
        {busy && <span className="self-center text-sm text-neutral-500">Running {busy}…</span>}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Requests" value={s?.requested ?? 0} />
        <Stat label="Real CRS calls" value={s?.crsCalls ?? 0} accent="text-blue-600" />
        <Stat label="Reused" value={s?.reused ?? 0} accent="text-teal-600" />
        <Stat label="Blocked" value={s?.blocked ?? 0} accent="text-red-600" />
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-sm">
          <span>Simulated budget</span>
          <span>
            ${b?.spent ?? 0} spent{b && b.reserved > 0 ? ` + $${b.reserved} reserved` : ""} / ${b?.total ?? 0}
          </span>
        </div>
        <div className="mt-1 h-2 rounded bg-neutral-200 dark:bg-neutral-800">
          <div className="h-2 rounded bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase text-neutral-500">Event log</h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="border-b border-neutral-300 text-xs uppercase text-neutral-500 dark:border-neutral-700">
          <tr>
            <th className="py-2">Agent</th>
            <th>Task</th>
            <th>Status</th>
            <th>Detail</th>
            <th>RequestID</th>
          </tr>
        </thead>
        <tbody>
          {(state?.events.length ?? 0) === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-neutral-500">
                Run a scenario to see the agents work.
              </td>
            </tr>
          )}
          {state?.events.map((e) => (
            <tr key={e.id} className="border-b border-neutral-200 align-top dark:border-neutral-800">
              <td className="py-1.5 capitalize">{e.agent}</td>
              <td className="font-mono text-xs">{e.taskKey}</td>
              <td className={STATUS_STYLE[e.status] ?? ""}>{e.status}</td>
              <td className="max-w-xs text-xs text-neutral-600 dark:text-neutral-400">{e.detail}</td>
              <td className="font-mono text-xs">{e.requestId?.slice(0, 8) ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function Stat({ label, value, accent = "" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs uppercase text-neutral-500">{label}</div>
      <div className={`text-3xl font-semibold ${accent}`}>{value}</div>
    </div>
  );
}
