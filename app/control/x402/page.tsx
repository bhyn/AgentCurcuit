"use client";

import Link from "next/link";
import { useState } from "react";

type PolicyResult = {
  mode?: string;
  result?: string;
  reason?: string;
  hasReceivingWallet?: boolean;
  parameters?: { role: string; personaId: string; network: string; amountUSDC: string; recipient: string };
  note?: string;
  error?: string;
};
type ProbeResult = { status: number; name: string; explanation: string; details: string };

const css = `
.x402-page{min-height:100vh;background:#080f20;color:#e8edf8;font-family:Inter,system-ui,Segoe UI,sans-serif;padding:40px 32px 65px}
.x402-shell{max-width:1080px;margin:0 auto}.x402-header{display:flex;justify-content:space-between;align-items:start;gap:20px;margin-bottom:36px}
.x402-brand{display:flex;align-items:center;gap:12px;font-size:14px;color:#a8b7d4}.x402-mark{background:linear-gradient(135deg,#5b75ff,#9d6aff);border-radius:10px;padding:10px 14px;color:white;font-weight:900}
.x402-back{color:#c4cfff;border:1px solid #35425b;padding:10px 14px;border-radius:10px;text-decoration:none;font-size:13px}
.x402-eyebrow{font-size:12px;font-weight:800;color:#9c9ffc;letter-spacing:.14em;margin-bottom:12px}.x402-h1{font-size:34px;letter-spacing:-.045em;margin:0 0 14px}.x402-lead{color:#a6b3cc;font-size:15px;line-height:1.7;max-width:740px;margin:0 0 30px}
.x402-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:32px}.x402-step{padding:17px 15px;border:1px solid #283751;background:#111a2e;border-radius:13px;min-width:0}.x402-step b{display:block;font-size:13px}.x402-step small{display:block;color:#8498b6;margin-top:5px;line-height:1.5}
.x402-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.x402-card{background:#121e33;border:1px solid #2a3954;border-radius:18px;padding:25px;min-width:0}
.x402-card h2{font-size:19px;margin:0 0 9px}.x402-info{font-size:13px;line-height:1.65;color:#a3b2ce;margin:0 0 22px}.x402-buttons{display:flex;flex-wrap:wrap;gap:9px}
.x402-btn{appearance:none;border:1px solid #46516c;border-radius:9px;background:#1e2943;color:#edf0fc;font-weight:700;font-size:13px;padding:11px 14px;cursor:pointer;min-height:40px}.x402-btn:hover:not(:disabled){border-color:#8699ff}.x402-btn:disabled{opacity:.45;cursor:default}.x402-btn.primary{background:#6557ed;border-color:#6557ed}.x402-btn.danger{background:#3b2437;border-color:#76455a}.x402-result{background:#090f1d;border:1px solid #283650;border-radius:12px;padding:17px;margin-top:19px;min-height:130px;overflow:auto}
.x402-result h3{font-size:15px;margin:0 0 8px}.x402-result p{color:#bccae2;font-size:13px;line-height:1.6;margin:7px 0}.x402-mono{font-family:Consolas,monospace;font-size:12px;overflow-wrap:anywhere}.x402-tag{display:inline-block;font-size:11px;font-weight:800;color:#a2e9ca;border:1px solid #2e7656;background:#103c31;border-radius:7px;padding:4px 7px;margin-bottom:12px}.x402-tag.warn{color:#f5ca87;border-color:#775534;background:#3a2b22}.x402-tag.block{color:#ffb2bd;border-color:#77404f;background:#3b2432}
.x402-note{margin-top:22px;color:#8696b1;font-size:12px;line-height:1.7}.x402-code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 Consolas,monospace;background:#090f1c;padding:13px;border-radius:9px;color:#bdd6ff;border:1px solid #253450}
@media(max-width:820px){.x402-page{padding:25px 16px}.x402-flow{grid-template-columns:repeat(2,1fr)}.x402-grid{grid-template-columns:1fr}.x402-h1{font-size:27px}.x402-header{flex-wrap:wrap}}
@media(max-width:440px){.x402-flow{grid-template-columns:1fr 1fr}.x402-step{padding:12px}}
`;

export default function X402DemoPage() {
  const [policy, setPolicy] = useState<PolicyResult | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  async function preview(scenario: "approved" | "unauthorized" | "over-budget") {
    setBusy(true);
    try {
      const res = await fetch("/api/control/x402/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
        cache: "no-store",
      });
      setPolicy((await res.json()) as PolicyResult);
    } catch (error) {
      setPolicy({ error: error instanceof Error ? error.message : "Request failed" });
    } finally { setBusy(false); }
  }

  async function probe402() {
    setChecking(true);
    try {
      const response = await fetch("/api/control/x402/report", { cache: "no-store" });
      const header = response.headers.get("PAYMENT-REQUIRED");
      if (response.status === 402) {
        setProbe({ status: 402, name: "PAYMENT REQUIRED", explanation: "Actual x402 server challenge received. No payment has been made.", details: header ? "PAYMENT-REQUIRED header received (x402 v2)." : "402 received; PAYMENT-REQUIRED header not visible." });
      } else {
        const body = (await response.json()) as { error?: string; mode?: string };
        setProbe({ status: response.status, name: response.status === 503 ? "SETUP NEEDED" : "UNEXPECTED STATUS", explanation: body.error || "Review the response.", details: body.mode || "No x402 payment was attempted." });
      }
    } catch (error) {
      setProbe({ status: 0, name: "CONNECTION ERROR", explanation: error instanceof Error ? error.message : "Request failed", details: "Confirm Next.js is running on port 3000." });
    } finally { setChecking(false); }
  }

  return (
    <main className="x402-page">
      <style>{css}</style>
      <div className="x402-shell">
        <header className="x402-header">
          <div className="x402-brand"><span className="x402-mark">A</span><span><b>AgentCircuit</b><br/>Payments Lab · Base Sepolia</span></div>
          <Link href="/control" className="x402-back">← Back to Control Tower</Link>
        </header>
        <p className="x402-eyebrow">PAYMENT AGENT / X402 PROTOCOL</p>
        <h1 className="x402-h1">Autonomous payments. Controlled by policy.</h1>
        <p className="x402-lead">Test a $0.01 USDC API payment workflow. AI agents can propose payment, but identity, destination, network and spending limits must be checked before signing.</p>
        <div className="x402-flow">
          <div className="x402-step"><b>01 · Request API</b><small>Credit Agent requests fictional P01 data</small></div>
          <div className="x402-step"><b>02 · HTTP 402</b><small>Resource server advertises $0.01 USDC</small></div>
          <div className="x402-step"><b>03 · Policy gate</b><small>Payment Agent + allowlisted receiver + limit</small></div>
          <div className="x402-step"><b>04 · Settlement</b><small>Only after explicit testnet signing (CLI)</small></div>
        </div>
        <div className="x402-grid">
          <section className="x402-card">
            <h2>01. Payment authorization preview</h2>
            <p className="x402-info">Three deterministic policy scenarios. This is a <b>dry run</b>; no real Fetch.ai signer has been authenticated, and no wallet is used.</p>
            <div className="x402-buttons">
              <button type="button" className="x402-btn primary" disabled={busy} onClick={() => void preview("approved")}>Authorized agent</button>
              <button type="button" className="x402-btn danger" disabled={busy} onClick={() => void preview("unauthorized")}>Unauthorized agent</button>
              <button type="button" className="x402-btn" disabled={busy} onClick={() => void preview("over-budget")}>Over budget</button>
            </div>
            <div className="x402-result" aria-live="polite">
              {policy ? <>
                <span className={`x402-tag ${policy.error || policy.result === "BLOCKED" ? "block" : !policy.hasReceivingWallet ? "warn" : ""}`}>{policy.result || "ERROR"}</span>
                <h3>{policy.parameters?.role?.toUpperCase() || "Policy request"}</h3>
                <p>{policy.reason || policy.error}</p>
                {policy.parameters && <p className="x402-mono">{policy.parameters.amountUSDC} USDC · {policy.parameters.network} · {policy.parameters.recipient}</p>}
                <p>{policy.note}</p>
              </> : <p>Select a scenario above to inspect the decision.</p>}
            </div>
          </section>
          <section className="x402-card">
            <h2>02. Real x402 HTTP challenge</h2>
            <p className="x402-info">Call the actual x402-protected API without payment. Expect HTTP 402 and a PAYMENT-REQUIRED header. A receiving wallet must first be configured.</p>
            <button type="button" className="x402-btn primary" disabled={checking} onClick={() => void probe402()}>{checking ? "Checking..." : "Inspect HTTP 402"}</button>
            <div className="x402-result" aria-live="polite">
              {probe ? <>
                <span className={`x402-tag ${probe.status === 402 ? "" : "warn"}`}>HTTP {probe.status || "ERR"}</span>
                <h3>{probe.name}</h3>
                <p>{probe.explanation}</p>
                <p className="x402-mono">{probe.details}</p>
              </> : <p>Use the inspect button to check whether the paid resource is responding.</p>}
            </div>
          </section>
        </div>
        <section className="x402-card" style={{marginTop:20}}>
          <h2>03. Payment Agent · Base Sepolia testnet</h2>
          <p className="x402-info">To actually sign a $0.01 testnet USDC x402 payment, run this local script only after configuring a dedicated buyer wallet. This step cannot be triggered from the browser.</p>
          <code className="x402-code">node --env-file=.env.local scripts/x402-payment-agent.mjs<br/>node --env-file=.env.local scripts/x402-payment-agent.mjs --pay</code>
          <p className="x402-note">First command: policy + payment requirements only (no transaction). Second command: testnet signing/settlement, requires explicit X402_ENABLE_TESTNET_PAYMENT=YES. Never use a wallet with real funds in this demo.</p>
        </section>
        <p className="x402-note">Separate proof of concept: this page does not yet use the existing signed uAgents messaging or the live CRS API. The existing Control Tower remains untouched.</p>
      </div>
    </main>
  );
}
