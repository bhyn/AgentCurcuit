import "server-only";
import { timingSafeEqual } from "node:crypto";
import { canonicalString, isAgentAddress, verifyAgentSignature } from "./agent-signature";
import { store, type RegisteredAgent } from "./store";

const MAX_CLOCK_SKEW_MS = 120_000;
const NONCE_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 16_384;

export type AgentCheck = { ok: true; address: string } | { ok: false; status: number; error: string };

export type SignedJson =
  | { ok: true; address: string; body: Record<string, unknown> }
  | { ok: false; response: Response };

/** 404 unless running under `next dev`; null when the route may proceed. */
export function devOnly(): Response | null {
  if (process.env.NODE_ENV === "development") return null;
  return Response.json({ error: "Not available" }, { status: 404 });
}

/** Operator token (Authorization: Bearer …). Used only to enroll agents. */
export function hasOperatorToken(request: Request): boolean {
  const token = process.env.AGENTCIRCUIT_AGENT_TOKEN;
  const provided = request.headers.get("authorization");
  if (!token || !provided) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function registeredAgent(address: string): RegisteredAgent | undefined {
  return store.agents.get(address);
}

function pruneNonces(now: number) {
  // Nonces are inserted in expiry order, so stop at the first live one.
  for (const [nonce, expiresAt] of store.nonces) {
    if (expiresAt > now) break;
    store.nonces.delete(nonce);
  }
}

function reject(error: string): AgentCheck {
  return { ok: false, status: 401, error };
}

/**
 * Verify the X-Agent-* signature headers of a POST whose raw body was already read.
 * `path` is the route's own constant, never derived from request.url.
 */
export function verifyAgentRequest(request: Request, rawBody: string, path: string): AgentCheck {
  const address = request.headers.get("x-agent-address");
  const timestamp = request.headers.get("x-agent-timestamp");
  const nonce = request.headers.get("x-agent-nonce");
  const signature = request.headers.get("x-agent-signature");
  if (!address || !timestamp || !nonce || !signature) return reject("Missing agent signature headers");

  const now = Date.now();
  if (!/^\d{1,16}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
    return reject("Stale timestamp");
  }
  if (!/^[0-9a-f]{32}$/.test(nonce)) return reject("Invalid nonce");
  pruneNonces(now);
  if (store.nonces.has(nonce)) return reject("Replayed nonce");
  if (!isAgentAddress(address)) return reject("Invalid agent address");
  if (!verifyAgentSignature({ address, signature, canonical: canonicalString(path, timestamp, nonce, rawBody) })) {
    return reject("Invalid signature");
  }

  // Record the nonce only once the signature is known to be genuine.
  store.nonces.set(nonce, now + NONCE_TTL_MS);
  // Bech32 also allows all-uppercase; one spelling per key keeps the registry unambiguous.
  return { ok: true, address: address.toLowerCase() };
}

/**
 * Read a signed agent POST exactly once: size limit, signature over the raw
 * bytes, then a JSON object body.
 */
export async function readSignedJson(
  request: Request,
  path: string,
  limit: { maxBytes: number; tooLarge: string } = { maxBytes: MAX_BODY_BYTES, tooLarge: "Body too large" },
): Promise<SignedJson> {
  const fail = (status: number, error: string): SignedJson => ({
    ok: false,
    response: Response.json({ error }, { status }),
  });

  if (Number(request.headers.get("content-length") || "0") > limit.maxBytes) return fail(413, limit.tooLarge);
  const rawBody = await request.text().catch(() => null);
  if (rawBody === null) return fail(400, "Invalid body");
  if (Buffer.byteLength(rawBody, "utf8") > limit.maxBytes) return fail(413, limit.tooLarge);

  const check = verifyAgentRequest(request, rawBody, path);
  if (!check.ok) return fail(check.status, check.error);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "Invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Invalid body");
  return { ok: true, address: check.address, body: body as Record<string, unknown> };
}
