import type express from "express";
import { spawn, type ChildProcess } from "child_process";
import path from "path";

/**
 * Owns the FastAPI backend process and every call into it.
 *
 * FastAPI is the single runtime for tool execution and database access: Vapi's tool
 * webhook, the browser's tRPC calls, and the LangGraph flow all resolve through here.
 * Keeping the lifecycle in one module is what stops a second, divergent copy of the
 * lookup logic from reappearing on the Node side.
 */

const fastApiPort = process.env.VOICE_AGENT_BACKEND_PORT || "8000";
export const fastApiBaseUrl = process.env.VOICE_AGENT_BACKEND_URL || `http://127.0.0.1:${fastApiPort}`;

const STARTUP_TIMEOUT_MS = 15_000;

let fastApiProcess: ChildProcess | null = null;
let fastApiStartPromise: Promise<void> | null = null;

async function fastApiHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${fastApiBaseUrl}/api/health`);
    if (!response.ok) return false;
    // Another service may already hold the port. Only treat it as ours if it
    // answers with this backend's health payload.
    const body = (await response.json()) as { service?: string };
    return body?.service === "fastapi-voice-agent";
  } catch {
    return false;
  }
}

export async function ensureFastApiBackend(): Promise<void> {
  if (await fastApiHealthy()) return;
  if (fastApiStartPromise) return fastApiStartPromise;

  fastApiStartPromise = new Promise<void>((resolve, reject) => {
    const backendPath = path.join(process.cwd(), "backend");
    // Without --reload, a surviving uvicorn child is reused across Node restarts and
    // Python edits appear to have no effect until the process is killed by hand.
    const reloadArgs = process.env.NODE_ENV === "development" ? ["--reload", "--reload-dir", "app"] : [];
    fastApiProcess = spawn(process.env.PYTHON_BIN || "python3", [
      "-m", "uvicorn", "app.server:app", "--host", "127.0.0.1", "--port", fastApiPort, ...reloadArgs,
    ], {
      cwd: backendPath,
      env: { ...process.env, PYTHONPATH: backendPath },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };

    fastApiProcess.stdout?.on("data", chunk => console.log(`[fastapi] ${String(chunk).trim()}`));
    fastApiProcess.stderr?.on("data", chunk => console.error(`[fastapi] ${String(chunk).trim()}`));
    fastApiProcess.once("error", error => settle(error));
    fastApiProcess.once("exit", code => {
      if (!settled) settle(new Error(`FastAPI exited before becoming healthy (code ${code ?? "unknown"})`));
      fastApiProcess = null;
    });

    const startedAt = Date.now();
    const poll = async () => {
      if (await fastApiHealthy()) return settle();
      if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
        return settle(new Error(`FastAPI did not become healthy within ${STARTUP_TIMEOUT_MS / 1000} seconds`));
      }
      setTimeout(poll, 250);
    };
    void poll();
  }).finally(() => {
    fastApiStartPromise = null;
  });

  return fastApiStartPromise;
}

/** Calls the FastAPI backend, starting it first if it is not already running. */
export async function callFastApi<T>(
  routePath: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  await ensureFastApiBackend();
  const method = init.method ?? "GET";
  const response = await fetch(`${fastApiBaseUrl}${routePath}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
  });
  if (!response.ok) {
    throw new Error(`FastAPI ${method} ${routePath} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Express passthrough for the routes Vapi and the browser call directly. */
export async function forwardToFastApi(req: express.Request, res: express.Response) {
  try {
    await ensureFastApiBackend();
    const response = await fetch(`${fastApiBaseUrl}${req.path}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "GET" ? undefined : JSON.stringify(req.body || {}),
    });
    const contentType = response.headers.get("content-type") || "application/json";
    const body = await response.text();
    return res.status(response.status).setHeader("content-type", contentType).send(body);
  } catch (error) {
    console.error("[voice-agent] FastAPI proxy failure", error);
    return res.status(503).json({
      ok: false,
      error: { code: "FASTAPI_UNAVAILABLE", message: "The voice-agent backend is temporarily unavailable." },
    });
  }
}
