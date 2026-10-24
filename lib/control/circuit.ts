import "server-only";
import { crsPost, type CrsResult } from "@/lib/crs/client";
import { BUREAUS, getPersona, type Bureau } from "@/lib/crs/personas";
import { logEvent, store, type AgentName } from "./store";

// Simulated price per bureau pull. The sandbox is free; this only exercises the budget logic.
export const COST_PER_PULL = 2;

// What each agent may read. Payment never sees raw credit files.
const PERMISSIONS: Record<AgentName, string[]> = {
  credit: ["credit_report"],
  fraud: ["credit_report"],
  payment: [],
};

export type TaskOutcome =
  | { kind: "result"; source: "crs" | "cache" | "inflight"; result: CrsResult }
  | { kind: "blocked"; reason: "budget" | "permission"; detail: string }
  | { kind: "failed"; detail: string };

/**
 * Run a credit-report pull for an agent through the control layer.
 * Everything up to the first `await` is synchronous, so the dedupe check and the
 * budget reservation are atomic: concurrent agents cannot both pay for the same pull
 * or jointly overshoot the budget.
 */
export function requestCreditReport(agent: AgentName, personaId: string, bureau: Bureau): Promise<TaskOutcome> {
  const taskKey = `credit_report:${personaId}:${bureau}`;
  store.stats.requested++;

  if (!PERMISSIONS[agent].includes("credit_report")) {
    const detail = `${agent} agent has no access to credit_report`;
    logEvent({ agent, taskKey, status: "blocked-permission", detail });
    store.stats.blocked++;
    return Promise.resolve({ kind: "blocked", reason: "permission", detail });
  }

  const cached = store.cache.get(taskKey);
  if (cached) {
    logEvent({ agent, taskKey, status: "reused-cache", detail: "Reusing stored result", requestId: cached.requestId });
    store.stats.reused++;
    return Promise.resolve({ kind: "result", source: "cache", result: cached });
  }

  const running = store.inflight.get(taskKey);
  if (running) {
    logEvent({ agent, taskKey, status: "reused-inflight", detail: "Joined a pull already in progress" });
    store.stats.reused++;
    return running.then(
      (result) => ({ kind: "result", source: "inflight", result }) as TaskOutcome,
      (e) => ({ kind: "failed", detail: String(e) }) as TaskOutcome,
    );
  }

  const persona = getPersona(personaId);
  if (!persona) return Promise.resolve({ kind: "failed", detail: `Unknown persona ${personaId}` });

  const b = store.budget;
  if (b.spent + b.reserved + COST_PER_PULL > b.total) {
    const detail = `Budget exceeded: $${b.spent + b.reserved} of $${b.total} committed, pull costs $${COST_PER_PULL}`;
    logEvent({ agent, taskKey, status: "blocked-budget", detail, cost: COST_PER_PULL });
    store.stats.blocked++;
    return Promise.resolve({ kind: "blocked", reason: "budget", detail });
  }

  b.reserved += COST_PER_PULL;
  store.stats.crsCalls++;
  logEvent({ agent, taskKey, status: "executing", detail: `Calling CRS (${BUREAUS[bureau].label})`, cost: COST_PER_PULL });

  const promise = crsPost(BUREAUS[bureau].path, persona.creditBody);
  store.inflight.set(taskKey, promise);

  return promise.then(
    (result) => {
      b.reserved -= COST_PER_PULL;
      b.spent += COST_PER_PULL;
      store.inflight.delete(taskKey);
      store.cache.set(taskKey, result);
      logEvent({
        agent,
        taskKey,
        status: "completed",
        detail: result.ok ? "Pull completed" : `Completed with errors: ${result.errorMessages[0]?.creditErrorMessageCode ?? "?"}`,
        requestId: result.requestId,
        cost: COST_PER_PULL,
      });
      return { kind: "result", source: "crs", result } as TaskOutcome;
    },
    (e) => {
      // Failed pull: give the reserved money back and let someone retry.
      b.reserved -= COST_PER_PULL;
      store.inflight.delete(taskKey);
      logEvent({ agent, taskKey, status: "failed", detail: String(e) });
      return { kind: "failed", detail: String(e) } as TaskOutcome;
    },
  );
}
