import { store } from "@/lib/control/store";

export async function GET() {
  return Response.json({
    budget: store.budget,
    stats: store.stats,
    events: store.events.slice(0, 60),
    agents: Array.from(store.agents.values()).sort((a, b) => a.enrolledAt - b.enrolledAt),
    decisions: Array.from(store.decisions.values()).sort((a, b) => b.ts - a.ts),
  });
}
