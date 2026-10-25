
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { isSameOrigin, mayControl, mayWatch } from "@/lib/control/deployment";

type Status =
  | "idle"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

type Runner = {
  child: ChildProcess | null;
  status: Status;
  goal: string;
  log: string;
  error: string;
};

const shared = globalThis as typeof globalThis & {
  __agentCircuitRunner?: Runner;
};

function getRunner(): Runner {
  if (!shared.__agentCircuitRunner) {
    shared.__agentCircuitRunner = {
      child: null,
      status: "idle",
      goal: "",
      log: "",
      error: "",
    };
  }
  return shared.__agentCircuitRunner;
}

// Dev server only. On this machine anyone may watch and control; through a
// tunnel, watching needs AGENTCIRCUIT_DEMO_CODE configured and controlling
// needs the visitor to send that code (lib/control/deployment.ts).
function localOnly(request: Request, write = false) {
  if (!(write ? mayControl(request) : mayWatch(request))) {
    return false;
  }
  return !write || isSameOrigin(request);
}

function appendLog(runner: Runner, value: string) {
  runner.log = (runner.log + value).slice(-12000);
}

export async function GET(request: Request) {
  if (!localOnly(request)) {
    return Response.json({ error: "Local development only" }, { status: 403 });
  }

  const runner = getRunner();

  return Response.json({
    status: runner.status,
    goal: runner.goal,
    error: runner.error,
    log: runner.log.slice(-5000),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!localOnly(request, true)) {
    return Response.json({ error: "Demo access code required" }, { status: 403 });
  }

  let body: { action?: string; goal?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runner = getRunner();

  if (body.action === "stop") {
    if (!runner.child || runner.status !== "running") {
      return Response.json({ status: runner.status });
    }

    runner.status = "stopping";

    if (process.platform === "win32" && runner.child.pid) {
      const stop = spawn(
        "taskkill",
        ["/PID", String(runner.child.pid), "/T", "/F"],
        { windowsHide: true }
      );

      stop.on("error", () => {
        runner.child?.kill();
      });
    } else {
      runner.child.kill();
    }

    return Response.json({ status: "stopping" });
  }

  if (body.action !== "start") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  if (runner.status === "running" || runner.status === "stopping") {
    return Response.json(
      { error: "Agents are already running" },
      { status: 409 }
    );
  }

  const goal = body.goal?.trim();

  if (!goal || goal.length > 500) {
    return Response.json(
      { error: "Goal must contain 1-500 characters" },
      { status: 400 }
    );
  }

  const root = process.cwd();
  const python = path.join(
    root,
    ".venv-fetch",
    "Scripts",
    "python.exe"
  );
  const script = path.join(
    root,
    "fetch_agents",
    "ai_coordinated_agents.py"
  );

  if (!existsSync(python) || !existsSync(script)) {
    return Response.json(
      { error: "Python environment or agent script missing" },
      { status: 500 }
    );
  }

  runner.status = "running";
  runner.goal = goal;
  runner.log = "";
  runner.error = "";

  const child = spawn(python, ["-B", script], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      AGENTCIRCUIT_DEMO_GOAL: goal,
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runner.child = child;

  child.stdout?.on("data", (data: Buffer) => {
    appendLog(runner, data.toString("utf8"));
  });

  child.stderr?.on("data", (data: Buffer) => {
    appendLog(runner, data.toString("utf8"));
  });

  child.on("error", (error) => {
    runner.status = "error";
    runner.error = error.message;
    runner.child = null;
  });

  child.on("close", (code) => {
    if (runner.child !== child) return;

    const wasStopping = runner.status === "stopping";
    runner.status =
      wasStopping || code === 0 ? "stopped" : "error";

    if (!wasStopping && code !== 0) {
      runner.error = `Agent process exited with code ${code}`;
    }

    runner.child = null;
  });

  return Response.json({
    status: "running",
    message: "AI agents started",
  }, { status: 202 });
}
