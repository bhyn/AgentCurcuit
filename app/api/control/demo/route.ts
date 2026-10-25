import { demoMode } from "@/lib/control/deployment";
import { RECORDING } from "@/lib/control/recorded-demo";

// Read-only. Tells the dashboard whether this server can run agents live and,
// when it cannot, serves the recorded runs bundled with the build.
export async function GET() {
  const mode = demoMode();
  return Response.json(
    mode === "live"
      ? { mode }
      : { mode, recordedWith: RECORDING.recordedWith, runs: RECORDING.runs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
