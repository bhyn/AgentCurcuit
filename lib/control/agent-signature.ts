import { createHash, createPublicKey, ECDH, verify } from "node:crypto";

// Pure helpers for uAgents request signatures. No Next.js aliases or relative
// runtime imports, so plain Node can import this file in tests.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
// DER header of a secp256k1 SubjectPublicKeyInfo wrapping a 65-byte uncompressed point.
const SPKI_PREFIX = Buffer.from("3056301006072a8648ce3d020106052b8104000a034200", "hex");

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= GENERATORS[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    high.push(hrp.charCodeAt(i) >> 5);
    low.push(hrp.charCodeAt(i) & 31);
  }
  return [...high, 0, ...low];
}

/**
 * Decode a bech32 string (BIP-173 checksum) into its prefix and 8-bit payload.
 * There is no 90-character limit: uAgents signatures are about 113 characters.
 * Returns null for anything malformed, including mixed case and non-zero padding.
 */
export function bech32Decode(value: string): { hrp: string; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 33 || code > 126) return null;
  }
  const lower = value.toLowerCase();
  if (value !== lower && value !== value.toUpperCase()) return null;
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos > 83 || pos + 7 > lower.length) return null;

  const hrp = lower.slice(0, pos);
  const words: number[] = [];
  for (const char of lower.slice(pos + 1)) {
    const word = CHARSET.indexOf(char);
    if (word === -1) return null;
    words.push(word);
  }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) return null;

  // Regroup 5-bit words into bytes; leftover bits must be zero padding.
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const word of words.slice(0, -6)) {
    acc = ((acc << 5) | word) & 0xfff;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) return null;
  return { hrp, bytes: Buffer.from(bytes) };
}

// The compressed public key inside an "agent1…" address, or null.
function agentKey(address: string): Buffer | null {
  const decoded = bech32Decode(address);
  if (!decoded || decoded.hrp !== "agent" || decoded.bytes.length !== 33) return null;
  return decoded.bytes[0] === 2 || decoded.bytes[0] === 3 ? decoded.bytes : null;
}

/** True for an "agent1…" address carrying a 33-byte compressed secp256k1 key. */
export function isAgentAddress(address: string): boolean {
  return agentKey(address) !== null;
}

/**
 * The exact text an agent signs for one request: six lines joined by "\n"
 * (version, method, route path, timestamp, nonce, hex SHA-256 of the body).
 */
export function canonicalString(path: string, timestamp: string, nonce: string, rawBody: string): string {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return ["AGENTCIRCUIT-V1", "POST", path, timestamp, nonce, bodyHash].join("\n");
}

/**
 * Check a uAgents signature ("sig1…", r||s over SHA-256) of `canonical` against
 * the signer's "agent1…" address. Returns false for malformed input; never throws.
 */
export function verifyAgentSignature(input: { address: string; signature: string; canonical: string }): boolean {
  try {
    const compressed = agentKey(input.address);
    const sig = bech32Decode(input.signature);
    if (!compressed || !sig || sig.hrp !== "sig" || sig.bytes.length !== 64) return false;
    const point = ECDH.convertKey(compressed, "secp256k1", undefined, undefined, "uncompressed");
    if (typeof point === "string") return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, point]), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(input.canonical, "utf8"), { key, dsaEncoding: "ieee-p1363" }, sig.bytes);
  } catch {
    return false;
  }
}

/** "agent1qabcdefg…uvwxyz": first 12 and last 6 characters, for logs. */
export function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 12)}…${address.slice(-6)}` : address;
}
