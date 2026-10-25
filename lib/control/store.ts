import type { CrsResult } from "@/lib/crs/client";
import type { BureauFacts, Decision, DecisionRoute } from "./policy";

export type AgentName = "credit" | "fraud" | "payment";

export const AGENT_NAMES: AgentName[] = ["credit", "fraud", "payment"];

export type EventStatus =
  | "executing"
  | "completed"
  | "reused-cache"
  | "reused-inflight"
  | "blocked-budget"
  | "blocked-permission"
  | "blocked-identity"
  | "blocked-payment"
  | "enrolled"
  | "decision-confirmed"
  | "decision-overridden"
  | "decision-policy-only"
  | "payment-authorized"
  | "failed";

export type ControlEvent = {
  id: number;
  ts: number;
  agent: AgentName | "unknown";
  taskKey: string;
  status: EventStatus;
  detail: string;
  requestId?: string | null;
  cost?: number;
  // Verified uAgent address of the caller, for signed requests.
  address?: string;
};

export type ActivityType =
  | "AI_DECISION"
  | "MESSAGE_SENT"
  | "MESSAGE_RECEIVED"
  | "SAFETY_OVERRIDE"
  | "FRAUD_ASSESSMENT"
  | "WORKFLOW_COMPLETE";

export type AgentActivity = {
  id: number;
  ts: number;
  type: ActivityType;
  agent: AgentName;
  address: string;
  detail: string;
  target?: AgentName;
  choice?: "fraud" | "payment" | "finish";
  model?: string;
};

// A uAgent address bound to one role at enrollment.
export type RegisteredAgent = {
  address: string;
  role: AgentName;
  name: string;
  enrolledAt: number;
};

export type DecisionRecord = {
  personaId: string;
  final: Decision;
  route: DecisionRoute;
  overridden: boolean;
  rules: string[];
  proposal: { recommendation: Decision; reason: string } | null;
  model: string | null;
  facts: BureauFacts[];
  ts: number;
  address: string;
};

type Store = {
  inflight: Map<string, Promise<CrsResult>>;
  cache: Map<string, CrsResult>;
  events: ControlEvent[];
  nextId: number;
  activity: AgentActivity[];
  nextActivityId: number;
  agents: Map<string, RegisteredAgent>;
  // Seen request nonces -> expiry time (ms).
  nonces: Map<string, number>;
  decisions: Map<string, DecisionRecord>;
  budget: { total: number; spent: number; reserved: number };
  stats: { requested: number; crsCalls: number; reused: number; blocked: number };
};

export const DEFAULT_BUDGET = 10;

function fresh(total = DEFAULT_BUDGET): Store {
  return {
    inflight: new Map(),
    cache: new Map(),
    events: [],
    nextId: 1,
    activity: [],
    nextActivityId: 1,
    agents: new Map(),
    nonces: new Map(),
    decisions: new Map(),
    budget: { total, spent: 0, reserved: 0 },
    stats: { requested: 0, crsCalls: 0, reused: 0, blocked: 0 },
  };
}

// Shared in-memory store, preserved across dev hot reload.
const g = globalThis as unknown as { __controlStore?: Store };
export const store: Store = (g.__controlStore ??= fresh());

// Handle a running dev process whose global store predates these fields.
store.activity ??= [];
store.nextActivityId ??= 1;
store.agents ??= new Map();
store.nonces ??= new Map();
store.decisions ??= new Map();

export function resetStore(total = DEFAULT_BUDGET) {
  // Seen nonces survive a reset, so a reset cannot reopen the replay window.
  const nonces = store.nonces;
  Object.assign(store, fresh(total), { nonces });
}

export function logEvent(e: Omit<ControlEvent, "id" | "ts">) {
  store.events.unshift({ id: store.nextId++, ts: Date.now(), ...e });
  if (store.events.length > 200) store.events.length = 200;
}

export function logActivity(e: Omit<AgentActivity, "id" | "ts">) {
  store.activity.unshift({ id: store.nextActivityId++, ts: Date.now(), ...e });
  if (store.activity.length > 200) store.activity.length = 200;
}
