#!/usr/bin/env node
// Standalone local x402 buyer experiment. Not yet wired to the Fetch.ai Bureau.
// No wallet secrets are sent to the browser, resource server or the assistant.
import { evaluateX402Policy, X402_NETWORK, X402_MAX_USDC_ATOMIC } from "../lib/control/x402-policy.mjs";

const uri = "http://127.0.0.1:3000/api/control/x402/report";
const payTo = process.env.X402_PAY_TO?.trim() || "";
const payRequested = process.argv.includes("--pay");
if (process.argv.some((arg) => arg !== "--pay" && arg.startsWith("--"))) {
  console.error("Only --pay is supported. Default is a no-payment dry run.");
  process.exit(2);
}

async function main() {
  console.log("AgentCircuit x402 Payment Agent experiment · Base Sepolia only");
  console.log("Mode:", payRequested ? "EXPLICIT TESTNET PAYMENT" : "DRY RUN (no payment)");
  const response = await fetch(uri, { headers: { "Cache-Control": "no-store" } });
  console.log("HTTP response:", response.status);
  if (response.status !== 402) {
    const text = await response.text();
    console.log(text.slice(0, 1000));
    console.log("Expected HTTP 402. Check X402_PAY_TO and the x402 API setup.");
    process.exitCode = 1;
    return;
  }

  const required = response.headers.get("PAYMENT-REQUIRED");
  if (!required) throw new Error("x402 v2 PAYMENT-REQUIRED header missing.");
  const requirement = JSON.parse(Buffer.from(required, "base64").toString("utf8"));
  const accepts = Array.isArray(requirement.accepts) ? requirement.accepts : [];
  const option = accepts.find((v) => v.scheme === "exact" && v.network === X402_NETWORK);
  if (!option) throw new Error("No exact Base Sepolia x402 payment option was offered.");
  const amount = Number(option.amount);
  const recipient = String(option.payTo || "");
  const decision = evaluateX402Policy({
    role: "payment", // Demo role only. NOT a verified uAgents signature.
    network: option.network,
    amountAtomic: amount,
    payTo: recipient,
    expectedPayTo: payTo,
    personaId: "P01",
    isSyntheticReport: true,
  });
  console.log("x402 requirement:", { network: option.network, amountUSDC: amount / 1e6, payTo: recipient });
  console.log("AgentCircuit policy:", decision.reason);
  if (!decision.allowed) { process.exitCode = 2; return; }
  if (!payRequested) {
    console.log("DRY RUN SUCCESS: policy passed. NO SIGNATURE, NO PAYMENT, NO PAID DATA.");
    console.log("To pay with test USDC, set X402_ENABLE_TESTNET_PAYMENT=YES and use --pay.");
    return;
  }
  if (process.env.X402_ENABLE_TESTNET_PAYMENT !== "YES") {
    throw new Error("Settlement disabled. Set X402_ENABLE_TESTNET_PAYMENT=YES in your local .env.local first.");
  }
  const privateKey = process.env.X402_BUYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[\da-fA-F]{64}$/.test(privateKey)) {
    throw new Error("A dedicated Base Sepolia buyer wallet private key is required in X402_BUYER_PRIVATE_KEY. Do not share it.");
  }
  if (amount > X402_MAX_USDC_ATOMIC) throw new Error("Hard-coded spending limit exceeded.");

  const [{ x402Client }, { wrapFetchWithPayment }, { ExactEvmScheme }, { privateKeyToAccount }] = await Promise.all([
    import("@x402/core/client"),
    import("@x402/fetch"),
    import("@x402/evm/exact/client"),
    import("viem/accounts"),
  ]);
  const wallet = privateKeyToAccount(privateKey);
  const x402 = new x402Client();
  x402.register(X402_NETWORK, new ExactEvmScheme(wallet));
  console.log("Buyer:", wallet.address);
  console.log("Signing a maximum of $0.01 testnet USDC. Do not repeat unless intended.");
  const paidFetch = wrapFetchWithPayment(fetch, x402);
  const paid = await paidFetch(uri, { method: "GET" });
  console.log("Payment-aware HTTP response:", paid.status);
  const receipt = paid.headers.get("PAYMENT-RESPONSE");
  if (receipt) {
    try { console.log("Settlement receipt:", JSON.parse(Buffer.from(receipt, "base64").toString("utf8"))); }
    catch { console.log("PAYMENT-RESPONSE received; could not decode it."); }
  }
  const body = await paid.text();
  console.log("Resource:", body.slice(0, 1500));
  if (!paid.ok || !receipt) {
    process.exitCode = 1;
    console.error("Settlement not proven. Do not claim PAID without a successful receipt.");
  }
}

main().catch((error) => {
  console.error("x402 experiment failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
