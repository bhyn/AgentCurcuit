import { getPersona } from "@/lib/crs/personas";

// List only personas whose *complete sandbox request fixtures* are already
// present locally. Never send an unknown/persona-free request to CRS: unmatched
// requests can be forwarded to the real upstream vendor.
// Server-only; no credit details, SSNs, or other persona inputs are returned.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Development-only sandbox catalog" }, { status: 403 });
  }
  const personas: string[] = [];
  for (let n = 1; n <= 99; n++) {
    const id = `P${String(n).padStart(2, "0")}`;
    try {
      if (getPersona(id)) personas.push(id);
    } catch {
      // Unknown fixture: do not expose it as supported.
    }
  }
  return Response.json(
    { personas, count: personas.length, source: "lib/crs/personas.ts" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
