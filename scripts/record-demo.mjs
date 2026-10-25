// Records real agent runs for the public Recorded Demo.
//
// Drives a LOCAL `npm run dev` server through the same APIs the Control Tower
// uses, waits for each workflow to finish, and saves what AgentCircuit actually
// recorded. Values from .env.local and local file paths are redacted. Runs that
// fail or never reach a WORKFLOW COMPLETE marker are reported and not saved.
//
//   npm run dev                                  (in another terminal)
//   node scripts/record-demo.mjs [--provider=gemini|ollama] [--only=<scenario id>]
//
// --only records one scenario and merges it into the existing file.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://localhost:3000";
const OUTPUT = path.join(ROOT, "lib", "control", "recorded-demo.json");
const RUN_TIMEOUT_MS = 240_000;

// Same goals as the examples in app/control/RunAgentPanel.tsx.
const FULL_TEST =
  "First investigate identity fraud in P01 using TransUnion. " +
  "After fraud review, test whether the payment agent can access the credit report.";
const SCENARIOS = [
  { id: "full-security-test", label: "Full security test", goal: FULL_TEST },
  { id: "credit-only", label: "Credit only", goal: "Only check the P01 TransUnion credit report. No other tasks are needed." },
  { id: "fraud-review", label: "Fraud review", goal: "Investigate possible identity fraud in P01 using TransUnion. Finish after the fraud review." },
  {
    id: "x402-allow",
    label: "x402 · ALLOW",
    goal: "Review P01's TransUnion report for fraud, then ask the Payment Agent to inspect the x402 paid synthetic API in DRY RUN mode. Do not make any payment.",
  },
  {
    id: "x402-block-budget",
    label: "x402 · BLOCK (budget)",
    goal: "Review P01's TransUnion report for fraud, then test an x402 payment over budget with the Payment Agent in DRY RUN mode. Do not make any payment.",
  },
];

// Values of credential-like keys in .env.local (model names and URLs are not secrets).
function envSecrets() {
  let text = "";
  try { text = readFileSync(path.join(ROOT, ".env.local"), "utf8"); } catch { return []; }
  return text.split(/\r?\n/)
    .filter((line) => /^\s*[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|USERNAME|SEED|PRIVATE|PAY_TO)[A-Z0-9_]*\s*=/.test(line))
    .map((line) => line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""))
    .filter((value) => value.length >= 6)
    .sort((a, b) => b.length - a.length);
}

const SECRETS = envSecrets();

function redact(value) {
  if (typeof value !== "string") return value;
  let out = value.replace(/\u001b\[[0-9;]*m/g, "");
  for (const secret of SECRETS) out = out.split(secret).join("[redacted]");
  return out
    .replace(/[A-Za-z]:\\[^\s"'<>|]*/g, "<local path>")
    .replace(/\/(?:Users|home)\/[^\s"'<>|]*/g, "<local path>");
}

function redactDeep(value) {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]));
  }
  return redact(value);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(route, body) {
  const response = await fetch(`${BASE}${route}`, body === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${data.error ?? ""}`.trim());
  return data;
}

async function stopRunner() {
  const runner = await call("/api/control/run-agents");
  if (runner.status === "running") await call("/api/control/run-agents", { action: "stop" });
  for (let i = 0; i < 30; i++) {
    const { status } = await call("/api/control/run-agents");
    if (status !== "running" && status !== "stopping") return;
    await sleep(1000);
  }
  throw new Error("Agent runner did not stop");
}

async function record(scenario, provider) {
  await stopRunner();
  await call("/api/control/scenario", { scenario: "reset" });
  await call("/api/control/ai-provider", { provider });
  await call("/api/control/run-agents", { action: "start", goal: scenario.goal });

  const started = Date.now();
  let runner;
  while (Date.now() - started < RUN_TIMEOUT_MS) {
    await sleep(2000);
    runner = await call("/api/control/run-agents");
    if (/WORKFLOW (?:COMPLETE|FAILED):/.test(runner.log) || runner.status === "error") break;
  }
  // Let the final activity reports reach the server.
  await sleep(3000);
  const [state, activity, final] = await Promise.all([
    call("/api/control/state"),
    call("/api/control/activity"),
    call("/api/control/run-agents"),
  ]);
  await stopRunner();

  const markers = final.log.split(/\r?\n/).filter((line) => /WORKFLOW (?:COMPLETE|FAILED):/.test(line));
  const outcome = markers.at(-1)?.trim() ?? "";
  if (!outcome || /WORKFLOW FAILED:|WORKFLOW COMPLETE:\s*FAILED:/.test(outcome)) {
    throw new Error(outcome || `no WORKFLOW marker within ${RUN_TIMEOUT_MS / 1000}s (runner ${final.status})`);
  }

  return redactDeep({
    id: scenario.id,
    label: scenario.label,
    goal: scenario.goal,
    provider,
    recordedAt: new Date(started).toISOString(),
    outcome: outcome.replace(/^.*?(WORKFLOW COMPLETE:)/, "$1"),
    log: final.log,
    activity: activity.activity ?? [],
    events: state.events ?? [],
    stats: state.stats,
    budget: state.budget,
    agents: state.agents ?? [],
  });
}

const providerArg = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1];
const provider = providerArg === "gemini" || providerArg === "ollama" ? providerArg : "ollama";
const only = process.argv.find((arg) => arg.startsWith("--only="))?.split("=")[1];
if (only && !SCENARIOS.some((scenario) => scenario.id === only)) {
  console.error(`Unknown scenario "${only}". Choose one of: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
  process.exit(1);
}

const runs = [];
for (const scenario of SCENARIOS.filter((item) => !only || item.id === only)) {
  process.stdout.write(`Recording "${scenario.label}" with ${provider}... `);
  try {
    const run = await record(scenario, provider);
    runs.push(run);
    console.log(`ok (${run.activity.length} activity, ${run.events.length} policy events)`);
  } catch (error) {
    console.log(`skipped: ${error instanceof Error ? error.message : error}`);
  }
}

if (runs.length === 0) {
  console.error("No run completed; recorded-demo.json left unchanged.");
  process.exit(1);
}
// With --only, keep the other recorded runs and order everything like SCENARIOS.
const kept = only ? JSON.parse(readFileSync(OUTPUT, "utf8")).runs.filter((run) => run.id !== only) : [];
const order = (run) => SCENARIOS.findIndex((scenario) => scenario.id === run.id);
const saved = [...kept, ...runs].sort((a, b) => order(a) - order(b));
writeFileSync(OUTPUT, `${JSON.stringify({ version: 1, recordedWith: "scripts/record-demo.mjs", runs: saved }, null, 2)}\n`);
console.log(`Saved ${saved.length} run(s) to ${path.relative(ROOT, OUTPUT)}`);
