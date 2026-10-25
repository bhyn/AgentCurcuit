import recording from "./recorded-demo.json";

// Runs captured from a live local workflow by scripts/record-demo.mjs.
// Nothing here is generated or edited by hand: every event, decision and log
// line was produced by the real agents and AgentCircuit during that run, then
// secrets and local paths were redacted.

export type RecordedActivity = {
  id: number;
  ts: number;
  type: "AI_DECISION" | "MESSAGE_SENT" | "MESSAGE_RECEIVED" | "SAFETY_OVERRIDE" | "FRAUD_ASSESSMENT" | "WORKFLOW_COMPLETE";
  agent: "credit" | "fraud" | "payment";
  address?: string;
  detail: string;
  target?: "credit" | "fraud" | "payment";
  choice?: "fraud" | "payment" | "finish";
  model?: string;
};

export type RecordedEvent = {
  id: number;
  ts: number;
  agent: string;
  taskKey: string;
  status: string;
  detail: string;
  requestId?: string | null;
  cost?: number;
  address?: string;
};

export type RecordedRun = {
  id: string;
  label: string;
  goal: string;
  provider: "gemini" | "ollama";
  recordedAt: string;
  outcome: string;
  log: string;
  activity: RecordedActivity[];
  events: RecordedEvent[];
  stats: { requested: number; crsCalls: number; reused: number; blocked: number };
  budget: { total: number; spent: number; reserved: number };
  agents: { address: string; role: string; name: string; enrolledAt: number }[];
};

export type Recording = {
  version: number;
  recordedWith: string;
  runs: RecordedRun[];
};

export const RECORDING = recording as Recording;
