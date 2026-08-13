import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import fs from "fs";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { loadConfig } from "../configLoader";
import { ensureFastApiBackend, forwardToFastApi } from "../fastApiBackend";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function appendProviderEvent(body: any) {
  const message = body?.message || body || {};
  const relativePath = loadConfig().paths.event_log;
  const eventPath = path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
  const safeEvent = {
    timestamp: new Date().toISOString(),
    type: message?.type || body?.type || "unknown",
    callId: body?.callId || message?.call?.id || null,
    endedReason: message?.endedReason || message?.call?.endedReason || null,
    error: message?.error || body?.error || null,
    hasTranscript: typeof message?.transcript === "string",
    toolCount: Array.isArray(message?.toolCallList) ? message.toolCallList.length : 0,
  };
  fs.mkdirSync(path.dirname(eventPath), { recursive: true });
  fs.appendFileSync(eventPath, `${JSON.stringify(safeEvent)}\n`, "utf8");
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  void ensureFastApiBackend().catch(error => console.error("[voice-agent] FastAPI startup failure", error));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // Vapi and the React client use FastAPI as the single runtime backend.
  // The health probe is called cross-origin by the browser (page on localhost,
  // probe against the public tunnel URL), so it needs an explicit CORS header.
  // It exposes no data beyond liveness.
  app.get("/api/voice-agent/health", (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  }, forwardToFastApi);
  app.get("/api/voice-agent/tenants", forwardToFastApi);
  // Work queue for the escalation team: calls that never reached a clean finish.
  app.get("/api/voice-agent/follow-ups", forwardToFastApi);
  app.get("/api/voice-agent/config/:tenantId", forwardToFastApi);
  app.post("/api/voice-agent/tools", forwardToFastApi);
  app.post("/api/voice-agent/events", forwardToFastApi);

  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  server.listen(port, () => console.log(`Server running on http://localhost:${port}/`));
}

startServer().catch(console.error);
