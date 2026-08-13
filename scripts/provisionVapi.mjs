/**
 * Registers this project's tools and assistant inside Vapi.
 *
 * Why this exists: tools passed inline via `model.tools` from the browser SDK reach the
 * model, but Vapi does not dispatch their `server.url` for a transient assistant started
 * with a public key. The model emits the tool call, nothing ever answers, and the agent
 * gives up. Tool *logic* still lives in this repo's FastAPI backend — only the tool
 * *registration* has to live in Vapi, pointing back at our public URL.
 *
 * Registration requires a PRIVATE Vapi key, which must never reach the browser, so this
 * runs from the command line.
 *
 *   VAPI_PRIVATE_KEY=... PUBLIC_SERVER_URL=https://<tunnel> node scripts/provisionVapi.mjs
 *
 * It is idempotent: existing tools and the assistant are matched by name and updated.
 * On success it prints the assistant id to put in VITE_VAPI_ASSISTANT_ID.
 */

import fs from "fs";
import path from "path";
import yaml from "yaml";
import "dotenv/config";

const VAPI_API = "https://api.vapi.ai";
const TENANT_ID = process.env.VOICE_AGENT_TENANT_ID || "observe-insurance";

const privateKey = process.env.VAPI_PRIVATE_KEY;
const publicServerUrl = (process.env.PUBLIC_SERVER_URL || process.env.VITE_PUBLIC_SERVER_URL || "").replace(/\/+$/, "");

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!privateKey) {
  fail(
    "VAPI_PRIVATE_KEY is not set.\n" +
    "  Get it from the Vapi dashboard → Organization → API Keys → Private Key.\n" +
    "  This is NOT the same as VITE_VAPI_PUBLIC_KEY, and it must never be committed\n" +
    "  or exposed to the browser.",
  );
}
if (!publicServerUrl || /localhost|127\.0\.0\.1/.test(publicServerUrl)) {
  fail(
    `PUBLIC_SERVER_URL must be a public https URL, got ${publicServerUrl || "(empty)"}.\n` +
    "  Vapi calls tools from its own cloud and cannot reach a local address.\n" +
    "  Start a tunnel first:  cloudflared tunnel --url http://localhost:3005",
  );
}

async function vapi(routePath, { method = "GET", body } = {}) {
  const response = await fetch(`${VAPI_API}${routePath}`, {
    method,
    headers: {
      authorization: `Bearer ${privateKey}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${routePath} → ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed;
}

function loadTenant() {
  const configPath = path.join(process.cwd(), "config.yaml");
  const config = yaml.parse(fs.readFileSync(configPath, "utf-8"));
  const tenant = config?.tenants?.[TENANT_ID];
  if (!tenant) fail(`Tenant ${TENANT_ID} not found in config.yaml`);
  return { tenant, config };
}

/** Vapi rejects unknown fields, so send only what a function tool accepts. */
function toolPayload(tool, serverUrl) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
    server: { url: `${serverUrl}/api/voice-agent/tools` },
    // Empty array suppresses Vapi's built-in "Hold on a sec" filler.
    messages: [],
  };
}

async function upsertTools(tenant) {
  const existing = await vapi("/tool");
  const byName = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter((t) => t?.function?.name)
      .map((t) => [t.function.name, t]),
  );

  const ids = [];
  for (const tool of tenant.tools ?? []) {
    const payload = toolPayload(tool, publicServerUrl);
    const found = byName.get(tool.name);
    if (found) {
      await vapi(`/tool/${found.id}`, { method: "PATCH", body: payload });
      console.log(`  updated  ${tool.name}  (${found.id})`);
      ids.push(found.id);
    } else {
      const created = await vapi("/tool", { method: "POST", body: payload });
      console.log(`  created  ${tool.name}  (${created.id})`);
      ids.push(created.id);
    }
  }
  return ids;
}

function assistantPayload(tenant, config, toolIds) {
  const tts = config.voice?.tts ?? {};
  const stt = config.voice?.transcriber ?? {};
  return {
    name: tenant.agent_name || "Sarah",
    firstMessage: tenant.first_message,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: config.llm?.assistant_provider || "openai",
      model: config.llm?.assistant_model || "gpt-4o",
      temperature: config.llm?.temperature ?? 0.2,
      messages: [{ role: "system", content: tenant.system_prompt }],
      toolIds,
    },
    voice: {
      provider: tts.provider,
      voiceId: tts.voice_id,
      speed: tts.speed,
      ...(tts.version != null ? { version: tts.version } : {}),
    },
    transcriber: {
      provider: stt.provider,
      model: stt.model,
      language: stt.language,
      endpointing: config.voice?.endpointing_ms ?? 500,
    },
    // Browser-visible events drive the transcript and tool-activity panel.
    clientMessages: ["transcript", "status-update", "tool-calls", "tool-calls-result"],
    serverMessages: ["status-update", "end-of-call-report", "tool-calls"],
    server: { url: `${publicServerUrl}/api/voice-agent/events` },
    // End completed conversations after the configured goodbye message.
    endCallFunctionEnabled: true,
    endCallMessage: config.voice?.goodbye_message || "Thanks for calling. Have a great day.",
    maxDurationSeconds: config.server?.timeout_seconds ?? 600,
  };
}

async function upsertAssistant(tenant, config, toolIds) {
  const name = tenant.agent_name || "Sarah";
  const existing = await vapi("/assistant");
  const found = (Array.isArray(existing) ? existing : []).find((a) => a?.name === name);
  const payload = assistantPayload(tenant, config, toolIds);

  if (found) {
    const updated = await vapi(`/assistant/${found.id}`, { method: "PATCH", body: payload });
    console.log(`  updated  assistant ${name}  (${found.id})`);
    return updated.id ?? found.id;
  }
  const created = await vapi("/assistant", { method: "POST", body: payload });
  console.log(`  created  assistant ${name}  (${created.id})`);
  return created.id;
}

async function main() {
  const { tenant, config } = loadTenant();
  console.log(`\nProvisioning tenant "${TENANT_ID}" against ${publicServerUrl}\n`);

  console.log("Tools:");
  const toolIds = await upsertTools(tenant);
  if (!toolIds.length) fail("No tools defined in config.yaml — nothing to register.");

  console.log("\nAssistant:");
  const assistantId = await upsertAssistant(tenant, config, toolIds);

  console.log(
    `\n✔ Done. Add this to .env, then restart the dev server and hard-reload the page:\n\n` +
    `    VITE_VAPI_ASSISTANT_ID=${assistantId}\n\n` +
    `  Re-run this script whenever the tunnel hostname changes or you edit tools,\n` +
    `  prompt, voice, or model in config.yaml — the registered copy lives in Vapi.\n`,
  );
}

main().catch((error) => fail(error.message));
