import "server-only";

const BASE_URL = process.env.CRS_BASE_URL ?? "https://api-sandbox.stitchcredit.com/api";

type TokenState = {
  token: string | null;
  expiresAt: number;
  inflight: Promise<string> | null;
  loginFailure: string | null;
};

// Survive Next.js dev hot reloads so we never log in more than needed.
const g = globalThis as unknown as { __crsToken?: TokenState };
const state: TokenState = (g.__crsToken ??= {
  token: null,
  expiresAt: 0,
  inflight: null,
  loginFailure: null,
});

export type CrsErrorMessage = {
  creditErrorMessageCode?: string;
  creditErrorMessageText?: string;
  creditErrorMessageSourceType?: string;
};

export type CrsResult = {
  httpStatus: number;
  requestId: string | null;
  // True only when HTTP is 2xx AND the body carries no errorMessages.
  ok: boolean;
  errorMessages: CrsErrorMessage[];
  body: unknown;
  durationMs: number;
};

async function login(): Promise<string> {
  // Failed logins can disable the account, so never retry after one.
  if (state.loginFailure) throw new Error(`CRS login disabled: ${state.loginFailure}`);

  const username = process.env.CRS_USERNAME;
  const password = process.env.CRS_PASSWORD;
  if (!username || !password) throw new Error("CRS_USERNAME / CRS_PASSWORD are not set");

  const res = await fetch(`${BASE_URL}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    state.loginFailure = `HTTP ${res.status} ${data?.codes?.join?.(",") ?? ""}`.trim();
    throw new Error(`CRS login failed: ${state.loginFailure}`);
  }
  state.token = data.token;
  // Refresh a minute early.
  state.expiresAt = Date.now() + Math.max((data.expires ?? 3600) - 60, 30) * 1000;
  return data.token;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && state.token && Date.now() < state.expiresAt) return state.token;
  // Concurrent callers share a single login.
  state.inflight ??= login().finally(() => {
    state.inflight = null;
  });
  return state.inflight;
}

function extractErrors(body: unknown): CrsErrorMessage[] {
  const errs = (body as { errorMessages?: unknown } | null)?.errorMessages;
  return Array.isArray(errs) ? (errs as CrsErrorMessage[]) : [];
}

/** POST a JSON body to a CRS sandbox path (e.g. "/experian/credit-report/standard/exp-prequal-vantage4"). */
export async function crsPost(path: string, payload: unknown): Promise<CrsResult> {
  const started = Date.now();
  let token = await getToken();

  const send = (t: string) =>
    fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

  let res = await send(token);
  if (res.status === 401) {
    // Token may have expired early: refresh once, then give up.
    state.token = null;
    token = await getToken(true);
    res = await send(token);
  }

  const body = await res.json().catch(() => null);
  const errorMessages = extractErrors(body);
  return {
    httpStatus: res.status,
    requestId: res.headers.get("RequestID"),
    ok: res.ok && errorMessages.length === 0,
    errorMessages,
    body,
    durationMs: Date.now() - started,
  };
}
