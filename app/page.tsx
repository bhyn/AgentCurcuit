"use client";

import { useState } from "react";

const PERSONAS = [
  { id: "P01", name: "Margaret Okafor", note: "Prime" },
  { id: "P13", name: "Kayla Brennan", note: "Synthetic identity" },
  { id: "P14", name: "Harold Pettigrew", note: "Deceased" },
  { id: "P15", name: "Nicole Farragut", note: "TU frozen" },
  { id: "P17", name: "Elena Castellanos", note: "Bureau divergence" },
];
const BUREAUS = ["transunion", "equifax", "experian"] as const;

type Row = {
  personaId: string;
  bureau: string;
  httpStatus: number;
  ok: boolean;
  requestId: string | null;
  durationMs: number;
  errorMessages: { creditErrorMessageCode?: string; creditErrorMessageText?: string }[];
  body?: {
    scores?: { scoreValue?: string | null }[];
    creditFiles?: { creditFileDetail?: { creditFileResultStatusType?: string } }[];
  };
  error?: string;
};

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(personaId: string) {
    setBusy(personaId);
    const results = await Promise.all(
      BUREAUS.map(async (bureau) => {
        const res = await fetch("/api/crs/credit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId, bureau }),
        });
        return { personaId, bureau, ...(await res.json()) } as Row;
      }),
    );
    setRows((prev) => [...results, ...prev]);
    setBusy(null);
  }

  return (
    <main className="mx-auto max-w-5xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">AgentCircuit · CRS sandbox check</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pulls a credit report from all three bureaus for a sandbox persona. Calls run on the server; credentials never reach the browser.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            onClick={() => run(p.id)}
            disabled={busy !== null}
            className="rounded-md border border-neutral-300 px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <div className="font-medium">
              {p.id} · {p.name}
            </div>
            <div className="text-xs text-neutral-500">{busy === p.id ? "Running…" : p.note}</div>
          </button>
        ))}
      </div>

      <table className="mt-8 w-full text-left text-sm">
        <thead className="border-b border-neutral-300 text-xs uppercase text-neutral-500 dark:border-neutral-700">
          <tr>
            <th className="py-2">Persona</th>
            <th>Bureau</th>
            <th>HTTP</th>
            <th>Score</th>
            <th>File status</th>
            <th>Errors</th>
            <th>RequestID</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-6 text-neutral-500">
                Pick a persona to run a live sandbox call.
              </td>
            </tr>
          )}
          {rows.map((r, i) => {
            const score = r.body?.scores?.find((s) => s.scoreValue)?.scoreValue ?? "—";
            const status = r.body?.creditFiles?.[0]?.creditFileDetail?.creditFileResultStatusType ?? "—";
            const bad = !r.ok || (status !== "FileReturned" && status !== "—");
            return (
              <tr key={i} className="border-b border-neutral-200 align-top dark:border-neutral-800">
                <td className="py-2">{r.personaId}</td>
                <td>{r.bureau}</td>
                <td>{r.httpStatus ?? "—"}</td>
                <td className="font-medium">{score}</td>
                <td className={bad ? "text-amber-600" : "text-green-600"}>{r.error ?? status}</td>
                <td className="max-w-xs text-xs text-red-600">
                  {r.errorMessages?.map((e) => `${e.creditErrorMessageCode}: ${e.creditErrorMessageText}`).join(" | ")}
                </td>
                <td className="font-mono text-xs">{r.requestId?.slice(0, 8) ?? "—"}</td>
                <td>{r.durationMs}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
