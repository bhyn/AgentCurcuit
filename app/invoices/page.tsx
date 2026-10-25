
"use client";

import { useEffect, useState } from "react";

type Invoice = {
  invoice_number: string;
  amount: number;
  status: string;
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/invoices", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error("Failed to load invoices");
        }

        setInvoices(result.invoices);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-10 text-white">
      <h1 className="text-4xl font-bold">AgentCircuit</h1>

      <p className="mt-2 text-slate-400">
        Autonomous Finance Control Tower
      </p>

      <h2 className="mb-5 mt-12 text-2xl font-semibold">
        Invoice Management
      </h2>

      {loading && <p>Loading invoices...</p>}
      {error && <p className="text-red-400">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {invoices.map((invoice) => (
          <div
            key={invoice.invoice_number}
            className="rounded-xl border border-slate-700 bg-slate-900 p-6"
          >
            <h3 className="text-lg font-semibold">
              {invoice.invoice_number}
            </h3>

            <p className="mt-4 text-2xl font-bold">
              ${Number(invoice.amount).toLocaleString()}
            </p>

            <p className="mt-3 text-sm text-amber-400">
              Status: {invoice.status}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}