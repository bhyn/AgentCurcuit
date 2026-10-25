import { NextResponse } from "next/server";
import {
  X402_NETWORK,
  X402_PRICE_USDC_ATOMIC,
  evaluateX402Policy,
} from "@/lib/control/x402-policy.mjs";

const noStore = { "Cache-Control": "no-store" };

// UI scenarios are intentionally pre-defined. Caller input is NOT a verified agent identity.
// Do not use this preview route to authorize real wallet spending.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Development-only policy preview." }, { status: 403, headers: noStore });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403, headers: noStore });
  }
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const scenario = body && typeof body === "object" && "scenario" in body
    ? (body as { scenario: unknown }).scenario
    : null;
  if (scenario !== "approved" && scenario !== "unauthorized" && scenario !== "over-budget") {
    return NextResponse.json({ error: "Choose approved, unauthorized or over-budget." }, { status: 400, headers: noStore });
  }
  const payTo = process.env.X402_PAY_TO?.trim() || "";
  const hasReceivingWallet = /^0x[\da-fA-F]{40}$/.test(payTo);
  // Clearly labeled placeholder used for dry-run previews ONLY; no wallet is involved.
  const previewPayTo = hasReceivingWallet ? payTo : "0x1111111111111111111111111111111111111111";
  const parameters = {
    role: scenario === "unauthorized" ? "fraud" : "payment",
    network: X402_NETWORK,
    amountAtomic: scenario === "over-budget" ? X402_PRICE_USDC_ATOMIC * 2 : X402_PRICE_USDC_ATOMIC,
    payTo: previewPayTo,
    expectedPayTo: previewPayTo,
    personaId: "P01",
    isSyntheticReport: true,
  };
  const policy = evaluateX402Policy(parameters);
  return NextResponse.json({
    mode: "POLICY_PREVIEW_ONLY",
    scenario,
    result: policy.allowed ? "ALLOW (no payment sent)" : "BLOCKED",
    reason: policy.reason,
    hasReceivingWallet,
    parameters: {
      role: parameters.role,
      personaId: parameters.personaId,
      network: parameters.network,
      amountUSDC: (parameters.amountAtomic / 1e6).toFixed(2),
      recipient: hasReceivingWallet ? `${payTo.slice(0, 8)}...${payTo.slice(-6)}` : "Demo placeholder (no wallet)",
    },
    note: "No Fetch.ai signature was verified and no on-chain transaction took place. Unconfigured preview uses a placeholder recipient.",
  }, { headers: noStore });
}
