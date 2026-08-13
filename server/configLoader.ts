import fs from "fs";
import path from "path";
import yaml from "yaml";

export const VAPI_MAX_ENDPOINTING_MS = 500;

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export interface SystemConfig {
  server: {
    port: number;
    host: string;
    timeout_seconds: number;
    max_json_body_size: string;
  };
  paths: {
    database: string;
    call_log: string;
    tool_log: string;
    event_log: string;
  };
  llm: {
    provider: string;
    model: string;
    temperature: number;
    max_tokens: number;
    api_base_url: string;
    /** Provider/model Vapi runs during the call, distinct from any server-side LLM use. */
    assistant_provider?: string;
    assistant_model?: string;
  };
  voice: {
    connect_timeout_seconds: number;
    connect_timeout_warning_seconds: number;
    inactivity_prompt_after_seconds: number;
    inactivity_timeout_seconds: number;
    inactivity_prompt_message: string;
    inactivity_timeout_message: string;
    goodbye_message: string;
    goodbye_delay_ms: number;
    endpointing_ms: number;
    default_provider: string;
    transcriber: {
      provider: string;
      model: string;
      language: string;
    };
    tts: {
      provider: string;
      voice_id: string;
      speed: number;
      /** Opts into Vapi's newer voice generation, labelled "<name>-v2" in the dashboard. */
      version?: number;
    };
  };
  tenants: Record<string, any>;
}

export function validateConfig(config: SystemConfig): SystemConfig {
  const endpointingMs = config.voice?.endpointing_ms;

  if (
    !Number.isFinite(endpointingMs) ||
    endpointingMs < 0 ||
    endpointingMs > VAPI_MAX_ENDPOINTING_MS
  ) {
    throw new ConfigValidationError(
      `[configLoader] voice.endpointing_ms must be a number between 0 and ${VAPI_MAX_ENDPOINTING_MS} milliseconds; received ${String(endpointingMs)}`,
    );
  }

  return config;
}

let cachedConfig: SystemConfig | null = null;

export function loadConfig(): SystemConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.join(process.cwd(), "config.yaml");

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      cachedConfig = validateConfig(yaml.parse(fileContent) as SystemConfig);
      return cachedConfig;
    } catch (err) {
      if (err instanceof ConfigValidationError) throw err;
      console.error("[configLoader] Failed to parse config.yaml, using defaults", err);
    }
  }

  // Fallback default config if file is missing or cannot be parsed.
  cachedConfig = validateConfig({
    server: { port: 3000, host: "0.0.0.0", timeout_seconds: 600, max_json_body_size: "50mb" },
    paths: { database: "server/database.json", call_log: "server/call-log.json", tool_log: "server/tool-call-log.json", event_log: "server/voice-event-log.jsonl" },
    llm: {
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 1024,
      api_base_url: "https://openrouter.ai/api/v1",
    },
    voice: {
      connect_timeout_seconds: 20,
      connect_timeout_warning_seconds: 5,
      inactivity_prompt_after_seconds: 10,
      inactivity_timeout_seconds: 20,
      inactivity_prompt_message: "I haven't heard back. Are you still there, or would you like me to continue?",
      inactivity_timeout_message: "I'm going to end this call because I haven't heard a response. Thanks for calling.",
      goodbye_message: "Thanks for calling Observe Insurance. Have a great day.",
      goodbye_delay_ms: 900,
      endpointing_ms: VAPI_MAX_ENDPOINTING_MS,
      default_provider: "vapi",
      transcriber: { provider: "deepgram", model: "nova-2", language: "en-US" },
      tts: { provider: "11labs", voice_id: "rachel", speed: 0.96 },
    },
    tenants: {},
  });
  return cachedConfig;
}
