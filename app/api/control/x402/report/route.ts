import { NextRequest, NextResponse } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { getPersona } from "@/lib/crs/personas";

// No real CRS call here: payment unlocks a fictional, public sample report only.
// Official x402 v2: 402 PAYMENT-REQUIRED, signed PAYMENT-SIGNATURE,
// facilitator verification/settlement, then 200 PAYMENT-RESPONSE.
const network = "eip155:84532" as const;
const payTo = process.env.X402_PAY_TO?.trim();
const ready = Boolean(payTo && /^0x[\da-fA-F]{40}$/.test(payTo));

async function sampleReport(request: NextRequest) {
  const personaId = (request.nextUrl.searchParams.get("personaId") || "P01").toUpperCase();
  return NextResponse.json({
    demo: true,
    synthetic: true,
    paidResource: "AgentCircuit x402 synthetic credit report",
    personaId,
    bureau: "Synthetic API (not a CRS bureau pull)",
    report: { status: "SAMPLE_DATA", note: "Fictional data. Not a real credit file." },
    message: "The x402 resource handler was reached after successful payment processing.",
  }, { headers: { "Cache-Control": "no-store" } });
}

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" }),
).register(network, new ExactEvmScheme());

const paidHandler = ready ? withX402(
  sampleReport,
  {
    accepts: {
      scheme: "exact",
      price: "$0.01",
      network,
      payTo: payTo!,
    },
    description: "Fictional AgentCircuit sandbox report for x402 payment demonstration",
    mimeType: "application/json",
  },
  resourceServer,
) : null;

// With Next.js cacheComponents, do not add `export const runtime = "nodejs"`.
export async function GET(request: NextRequest) {
  const personaId = (request.nextUrl.searchParams.get("personaId") || "P01").toUpperCase();
  if (!/^P\d{2,3}$/.test(personaId) || !getPersona(personaId)) {
    return NextResponse.json(
      { error: "Unknown CRS sandbox persona. No payment challenge issued." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!paidHandler) {
    return NextResponse.json({
      error: "x402 receiving address not configured.",
      instruction: "Set X402_PAY_TO in .env.local to your own Base Sepolia receiving address, then restart Next.js.",
      mode: "NOT_CONFIGURED",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return paidHandler(request);
}
