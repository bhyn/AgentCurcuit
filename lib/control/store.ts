import type { CrsResult } from "@/lib/crs/client";

export type AgentName = "credit" | "fraud" | "payment";

export type EventStatus =
  | "executing"
  | "completed"
  | "reused-cache"
  | "reused-inflight"
  | "blocked-budget"
  | "blocked-permission"
  | "failed";

export type ControlEvent = {
  id: number;
  ts: number;
  agent: AgentName;
  taskKey: string;
  status: EventStatus;
  detail: string;
  requestId?: string | null;
  cost?: number;
};

type Store = {
  inflight: Map<string, Promise<CrsResult>>;
  cache: Map<string, CrsResult>;
  events: ControlEvent[];
  nextId: number;
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
    budget: { total, spent: 0, reserved: 0 },
    stats: { requested: 0, crsCalls: 0, reused: 0, blocked: 0 },
  };
}

// Single in-memory store shared across route handlers (survives dev hot reload).
const g = globalThis as unknown as { __controlStore?: Store };
export const store: Store = (g.__controlStore ??= fresh());

export function resetStore(total = DEFAULT_BUDGET) {
  Object.assign(store, fresh(total));
}

export function logEvent(e: Omit<ControlEvent, "id" | "ts">) {
  store.events.unshift({ id: store.nextId++, ts: Date.now(), ...e });
  if (store.events.length > 200) store.events.length = 200;
}
