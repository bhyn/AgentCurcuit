import { timingSafeEqual } from "node:crypto";

// How this server can run the demo for a given visitor.
//
// Live execution needs the local Python uAgents Bureau, which only exists next
// to `next dev` on the team's laptop. People on that laptop always get the live
// demo. Visitors through a public tunnel get it only when AGENTCIRCUIT_DEMO_CODE
// is set, and must enter that code to start or stop agents. Everyone else (a
// Vercel deployment, `next start`, a tunnel without a code) replays a recording.
export type DemoAccess = "local" | "code";
export type DemoMode = { mode: "live"; access: DemoAccess } | { mode: "recorded" };

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * A request made on this machine. Requests through a Cloudflare tunnel carry
 * cf-connecting-ip, which the edge sets and a visitor cannot remove, so a
 * spoofed Host header alone does not pass.
 */
export function isLocalRequest(request: Request): boolean {
  if (request.headers.has("cf-connecting-ip")) return false;
  return LOCAL_HOSTS.includes(new URL(request.url).hostname);
}

function configuredDemoCode(): string | null {
  const code = process.env.AGENTCIRCUIT_DEMO_CODE?.trim();
  return code && code.length >= 8 ? code : null;
}

/** Tunnel visitors may watch the live demo (dev server with a demo code set). */
export function publicLiveEnabled(): boolean {
  return process.env.NODE_ENV === "development" && configuredDemoCode() !== null;
}

/** The X-Demo-Code header matches AGENTCIRCUIT_DEMO_CODE. */
export function hasDemoCode(request: Request): boolean {
  const code = configuredDemoCode();
  const given = request.headers.get("x-demo-code");
  if (!code || !given) return false;
  const expected = Buffer.from(code);
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The browser's Origin header matches this server. Behind the tunnel Next.js
 * still builds request.url as localhost; the visitor's address is the Host
 * header and scheme that Cloudflare's edge forwards.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  const expected = request.headers.has("cf-connecting-ip") && host
    ? `${request.headers.get("x-forwarded-proto") === "https" ? "https" : "http"}://${host}`
    : new URL(request.url).origin;
  try {
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

/** May start or stop agents, or change the AI provider. */
export function mayControl(request: Request): boolean {
  return process.env.NODE_ENV === "development" && (isLocalRequest(request) || hasDemoCode(request));
}

/** May read the live runner log. */
export function mayWatch(request: Request): boolean {
  return process.env.NODE_ENV === "development" && (isLocalRequest(request) || publicLiveEnabled());
}

export function demoMode(request: Request): DemoMode {
  if (process.env.NODE_ENV !== "development") return { mode: "recorded" };
  if (isLocalRequest(request)) return { mode: "live", access: "local" };
  return publicLiveEnabled() ? { mode: "live", access: "code" } : { mode: "recorded" };
}
