import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { isSameOrigin, mayControl } from "@/lib/control/deployment";

// Local development only. Both Next.js and Python share this non-secret choice.
const CHOICE_FILE = join(process.cwd(), ".agentcircuit-ai-provider.json");
type Provider = "gemini" | "ollama";

function isDevelopment() {
  return process.env.NODE_ENV === "development";
}

function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

async function currentProvider(): Promise<Provider> {
  try {
    const saved: unknown = JSON.parse(await readFile(CHOICE_FILE, "utf8"));
    if (saved && typeof saved === "object" && "provider" in saved) {
      const name = (saved as { provider?: unknown }).provider;
      if (name === "gemini" || name === "ollama") return name;
    }
  } catch {
    // Missing configuration defaults to Gemini only after a key is provided.
  }
  return geminiConfigured() ? "gemini" : "ollama";
}

export async function GET() {
  if (!isDevelopment()) return Response.json({ error: "Not available" }, { status: 404 });
  return Response.json(
    { provider: await currentProvider(), geminiConfigured: geminiConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isDevelopment()) return Response.json({ error: "Not available" }, { status: 404 });
  if (!mayControl(request)) return Response.json({ error: "Demo access code required" }, { status: 403 });
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Same-origin request required" }, { status: 403 });
  }
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request" }, { status: 400 });
  }
  const provider = data && typeof data === "object" && "provider" in data
    ? (data as { provider: unknown }).provider
    : null;
  if (provider !== "gemini" && provider !== "ollama") {
    return Response.json({ error: "Select Gemini or Ollama" }, { status: 400 });
  }
  if (provider === "gemini" && !geminiConfigured()) {
    return Response.json(
      { error: "Add GEMINI_API_KEY to .env.local, then restart Next.js" },
      { status: 400 },
    );
  }
  await writeFile(CHOICE_FILE, JSON.stringify({ provider }), { encoding: "utf8", mode: 0o600 });
  return Response.json({ provider, geminiConfigured: geminiConfigured() });
}
