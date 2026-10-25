// How this server can run the demo. Live execution needs the local Python
// uAgents Bureau, which only exists next to `next dev`. Any other server
// (a Vercel deployment, `next start`) replays a recorded run instead.
export type DemoMode = "live" | "recorded";

export function demoMode(): DemoMode {
  return process.env.NODE_ENV === "development" ? "live" : "recorded";
}
