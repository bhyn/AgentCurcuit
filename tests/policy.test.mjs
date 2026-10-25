import assert from "node:assert/strict";
import { evaluateX402Policy, X402_NETWORK } from "../lib/control/x402-policy.mjs";

const valid = {
  role: "payment",
  network: X402_NETWORK,
  amountAtomic: 10000,
  payTo: "0x1111111111111111111111111111111111111111",
  expectedPayTo: "0x1111111111111111111111111111111111111111",
  personaId: "P01",
  isSyntheticReport: true,
};
const allowed = evaluateX402Policy(valid);
assert.equal(allowed.allowed, true);
assert.equal(allowed.paymentAuthorized, false, "Policy approval must not claim settlement");
for (const [caseName, changed] of [
  ["unauthorized role", { role: "fraud" }],
  ["over budget", { amountAtomic: 10001 }],
  ["wrong recipient", { payTo: "0x2222222222222222222222222222222222222222" }],
  ["mainnet", { network: "eip155:8453" }],
  ["non P01 persona", { personaId: "P02" }],
  ["non-synthetic resource", { isSyntheticReport: false }],
  ["unconfigured receiver", { expectedPayTo: "" }],
]) {
  assert.equal(evaluateX402Policy({ ...valid, ...changed }).allowed, false, caseName);
}
console.log("PASS: x402 policy allow/deny tests (8 checks)");
