import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { loadConfig } from "./configLoader";
import { callFastApi } from "./fastApiBackend";

type FastApiTenant = {
  tenantId: string;
  organizationName: string;
  agentName: string;
  firstMessage: string | null;
  systemPrompt: string;
  faqs: Array<{ question: string; answer: string }>;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
};

/**
 * The browser needs tenants keyed by id; FastAPI returns them as a list. Reshaping here
 * rather than re-reading config.yaml in Node keeps one parser in front of the tool
 * schemas, so the tools handed to Vapi are always the tools the backend accepts.
 */
async function fetchTenants() {
  const { tenants } = await callFastApi<{ tenants: FastApiTenant[] }>("/api/voice-agent/tenants");
  return Object.fromEntries(tenants.map((tenant) => [tenant.tenantId, tenant]));
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  voiceAgent: router({
    getTenants: publicProcedure.query(() => fetchTenants()),

    getRuntimeConfig: publicProcedure.query(() => {
      const config = loadConfig();
      return {
        connectTimeoutMs: config.voice.connect_timeout_seconds * 1000,
        connectTimeoutWarningMs: Math.max(0, (config.voice.connect_timeout_seconds - config.voice.connect_timeout_warning_seconds) * 1000),
        inactivityPromptAfterMs: config.voice.inactivity_prompt_after_seconds * 1000,
        inactivityTimeoutMs: Math.max(config.voice.inactivity_prompt_after_seconds, config.voice.inactivity_timeout_seconds) * 1000,
        inactivityPromptMessage: config.voice.inactivity_prompt_message,
        inactivityTimeoutMessage: config.voice.inactivity_timeout_message,
        goodbyeMessage: config.voice.goodbye_message,
        goodbyeDelayMs: config.voice.goodbye_delay_ms,
        endpointingMs: config.voice.endpointing_ms || 500,
        hasAssistantId: Boolean(process.env.VITE_VAPI_ASSISTANT_ID),
        // Provider selection lives in config.yaml so switching TTS/STT/LLM (for example
        // after exhausting a provider quota) is a YAML edit, not a React edit.
        model: {
          provider: config.llm.assistant_provider || "groq",
          model: config.llm.assistant_model || "llama-3.3-70b-versatile",
          temperature: config.llm.temperature ?? 0.2,
        },
        // `version` is omitted rather than sent as null: Vapi rejects an assistant
        // that carries unexpected null fields on the voice config.
        voice: {
          provider: config.voice.tts.provider,
          voiceId: config.voice.tts.voice_id,
          speed: config.voice.tts.speed ?? 1,
          ...(config.voice.tts.version != null ? { version: config.voice.tts.version } : {}),
        },
        transcriber: {
          provider: config.voice.transcriber.provider,
          model: config.voice.transcriber.model,
          language: config.voice.transcriber.language,
        },
      };
    }),

    // Customer lookup, verification, tool execution, and call finalization are backend-owned.
    // The browser receives state only; it cannot create authoritative interaction records.
  }),
});

export type AppRouter = typeof appRouter;
