import { store } from "@/lib/control/store";

export async function GET() {
  return Response.json({
    budget: store.budget,
    stats: store.stats,
    events: store.events.slice(0, 60),
  });
}
