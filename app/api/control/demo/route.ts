import { demoMode } from "@/lib/control/deployment";
import { RECORDING } from "@/lib/control/recorded-demo";

// Read-only. Tells the dashboard whether this visitor gets the live demo (and
// whether it needs the demo access code) or, when it cannot, serves the
// recorded runs bundled with the build.
export async function GET(request: Request) {
  const demo = demoMode(request);
  return Response.json(
    demo.mode === "live"
      ? demo
      : { ...demo, recordedWith: RECORDING.recordedWith, runs: RECORDING.runs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
