// Safe demonstration policy. This module DOES NOT authenticate Fetch.ai signer identities.
// In production, "role" must come from the verified uAgents identity registry, not request JSON.
export const X402_NETWORK = "eip155:84532"; // Base Sepolia, never mainnet
export const X402_PRICE_USDC_ATOMIC = 10000; // $0.01 USDC, 6 decimals
export const X402_MAX_USDC_ATOMIC = 10000;

/**
 * @param {{role: string, network: string, amountAtomic: number, payTo: string, expectedPayTo: string, personaId: string, isSyntheticReport: boolean}} input
 */
export function evaluateX402Policy(input) {
  const deny = (reason) => ({ allowed: false, reason, paymentAuthorized: false });
  if (input.role !== "payment") return deny("BLOCKED: Only the Payment Agent may initiate the payment.");
  if (input.personaId !== "P01") return deny("BLOCKED: Only sandbox persona P01 is available in this demo.");
  if (input.isSyntheticReport !== true) return deny("BLOCKED: This pilot may only purchase the synthetic x402 report.");
  if (input.network !== X402_NETWORK) return deny("BLOCKED: Network must be Base Sepolia testnet.");
  if (!Number.isSafeInteger(input.amountAtomic) || input.amountAtomic < 1 || input.amountAtomic > X402_MAX_USDC_ATOMIC) {
    return deny("BLOCKED: Payment exceeds the $0.01 USDC per-request spending limit.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.expectedPayTo)) {
    return deny("BLOCKED: The approved receiving wallet is not configured.");
  }
  if (input.payTo.toLowerCase() !== input.expectedPayTo.toLowerCase()) {
    return deny("BLOCKED: The payment recipient is not on the allowlist.");
  }
  return {
    allowed: true,
    reason: "POLICY ALLOWED: Payment Agent / P01 / Base Sepolia / approved recipient / at most $0.01.",
    paymentAuthorized: false, // Only a verified settlement may change this elsewhere.
  };
}
