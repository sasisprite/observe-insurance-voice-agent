import { useEffect, useMemo, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Mic, MicOff, Phone, PhoneOff, ShieldCheck, Sparkles, Volume2, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatVapiError, getVapiAssistantConfigHint } from "@/lib/vapiDiagnostics";
import { extractVapiToolEvents, initialVapiSessionState, reduceVapiSession, type VapiSessionEvent, type VapiSessionStatus, type VapiToolEvent } from "@/lib/vapiSession";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { checkWebhookReachable, resolveEventServerUrl, resolveToolServerUrl, type WebhookReachability } from "@/lib/serverUrls";
import { buildVapiTools } from "@/lib/vapiTools";

type SessionStatus = VapiSessionStatus;
type TranscriptLine = { role: "user" | "assistant"; text: string };

const tenantId = "observe-insurance";
const publicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined;
const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined;

const publicServerUrl = (import.meta.env.VITE_PUBLIC_SERVER_URL as string | undefined)?.replace(/\/+$/, "");

/**
 * Fallback only. The live prompt, greeting, and provider selection come from
 * config.yaml via getTenants/getRuntimeConfig — edit the tone there, not here.
 */
const defaultFirstMessage = "Hi, you've reached Observe Insurance — I'm Sarah. What can I help you with today?";

const systemPrompt = `You are Sarah, the AI Claims Support Agent for Observe Insurance. Be upbeat, quick, and confident — this is claims support, not a hospital ward, so keep the pace up and get to the point. One or two short sentences per turn. Ask exactly one question at a time and never recite everything you need up front. Vary your acknowledgements and do not pad with filler. Ask first for the phone number or account ID, then call normalize_identifier with the caller's words exactly as spoken — never reformat the number yourself. Pass normalizedIdentifier to begin_tenant_lookup. When it returns verification_required, ask only for the date of birth, then call verify_tenant_record with the same identifier and the date exactly as said. Lead with the claim status, then the single most useful next step. Never invent customer, policy, or claim details. On not_found, say the account did not match and ask for the identifier again; do not ask for date of birth. After two failed verifications, offer a human agent. If the caller asks for a representative, hand off immediately. If someone describes an emergency in progress, tell them to contact emergency services first.`;

function parseToolPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function describeToolEvent(event: VapiToolEvent): string {
  const args = parseToolPayload(event.arguments);
  const result = parseToolPayload(event.result);
  if (event.name === "normalize_identifier" && typeof args?.rawIdentifier === "string") {
    const normalized = typeof result?.normalizedIdentifier === "string" ? ` → ${result.normalizedIdentifier}` : "";
    return `normalizing ${args.rawIdentifier}${normalized}`;
  }
  if ((event.name === "begin_tenant_lookup" || event.name === "verify_tenant_record") && typeof args?.identifier === "string") {
    const status = typeof result?.status === "string" ? ` · ${result.status}` : " · requested";
    return `${args.identifier}${status}`;
  }
  if (typeof result?.status === "string") return result.status;
  return "requested";
}

type RuntimeProviders = {
  model: { provider: string; model: string; temperature: number };
  voice: { provider: string; voiceId: string; speed: number; version?: number };
  transcriber: { provider: string; model: string; language: string };
};

function createAssistantConfig(
  prompt = systemPrompt,
  endpointingMs = 500,
  configuredTools: unknown[] = [],
  providers: RuntimeProviders,
  greeting = defaultFirstMessage,
) {
  return {
    name: "Sarah",
    firstMessage: greeting,
    model: {
      ...providers.model,
      messages: [{ role: "system", content: prompt }],
      tools: buildVapiTools(configuredTools, resolveToolServerUrl(window.location.origin, publicServerUrl))
    },
    // Providers come from config.yaml. Whichever is named must have a credential
    // attached in the Vapi dashboard, or the call draws on Vapi's shared allocation
    // and fails with a provider quota error once that is exhausted.
    voice: providers.voice,
    transcriber: { ...providers.transcriber, endpointing: endpointingMs },
    firstMessageMode: "assistant-speaks-first",
    clientMessages: ["transcript", "status-update", "tool-calls", "tool-calls-result"],
    serverMessages: ["status-update", "end-of-call-report", "tool-calls"],
    server: { url: resolveEventServerUrl(window.location.origin, publicServerUrl) },
    maxDurationSeconds: 600
  };
}

export default function Home() {
  const vapiRef = useRef<Vapi | null>(null);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.12);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [pendingTranscript, setPendingTranscript] = useState<TranscriptLine | null>(null);
  const [toolEvents, setToolEvents] = useState<VapiToolEvent[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [webhookHealth, setWebhookHealth] = useState<WebhookReachability | null>(null);
  const [showFaq, setShowFaq] = useState(false);
  const [escalated] = useState(false);
  const statusRef = useRef<SessionStatus>("idle");
  const hasConnectedRef = useRef(false);
  const connectionTimerRef = useRef<number | null>(null);
  const connectionWarningTimerRef = useRef<number | null>(null);
  const inactivityPromptTimerRef = useRef<number | null>(null);
  const inactivityTimeoutTimerRef = useRef<number | null>(null);
  const partialTimerRef = useRef<number | null>(null);
  const runtimeEndpointingRef = useRef(500);
  const sessionStateRef = useRef(initialVapiSessionState);
  const updateStatus = (next: SessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  };
  const { data: tenants } = trpc.voiceAgent.getTenants.useQuery();
  const { data: runtimeConfig } = trpc.voiceAgent.getRuntimeConfig.useQuery();
  const tenant = tenants?.[tenantId];
  const clearConnectionTimer = () => {
    if (connectionTimerRef.current !== null) {
      window.clearTimeout(connectionTimerRef.current);
      connectionTimerRef.current = null;
    }
  };
  const clearConnectionWarningTimer = () => {
    if (connectionWarningTimerRef.current !== null) {
      window.clearTimeout(connectionWarningTimerRef.current);
      connectionWarningTimerRef.current = null;
    }
  };
  const clearInactivityTimers = () => {
    if (inactivityPromptTimerRef.current !== null) window.clearTimeout(inactivityPromptTimerRef.current);
    if (inactivityTimeoutTimerRef.current !== null) window.clearTimeout(inactivityTimeoutTimerRef.current);
    inactivityPromptTimerRef.current = null;
    inactivityTimeoutTimerRef.current = null;
  };
  const clearPartialTimer = () => {

    if (partialTimerRef.current !== null) {
      window.clearTimeout(partialTimerRef.current);
      partialTimerRef.current = null;
    }
  };
  const applySessionEvent = (event: VapiSessionEvent) => {
    const next = reduceVapiSession(sessionStateRef.current, event);
    sessionStateRef.current = next;
    hasConnectedRef.current = next.hasConnected;
    updateStatus(next.status);
    setError(next.error);
    setTranscript(next.transcript);
    setPendingTranscript(next.pendingTranscript);
    setToolEvents(next.toolEvents);
  };

  useEffect(() => {
    runtimeEndpointingRef.current = runtimeConfig?.endpointingMs ?? 500;
  }, [runtimeConfig]);

  // Re-probed on focus as well as mount: a quick tunnel can die mid-session, and the
  // page would otherwise keep advertising a webhook Vapi can no longer reach.
  //
  // This runs for a registered assistant too — arguably it matters more there. The
  // registered tool's server.url is a snapshot of the tunnel taken at provisioning
  // time, so a new tunnel hostname silently invalidates it until the script is re-run.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const result = await checkWebhookReachable(window.location.origin, publicServerUrl);
      if (!cancelled) setWebhookHealth(result);
    };
    void probe();
    window.addEventListener("focus", probe);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", probe);
    };
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;
    // Dev-only handle for replaying provider messages without placing a real call, e.g.
    // __vapi.emit("message", { type: "transcript", role: "user", transcriptType: "partial", transcript: "..." })
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__vapi = vapi;

    vapi.on("call-start", () => {
      clearConnectionTimer();
      applySessionEvent({ type: "call-start" });
      armInactivityWatchdog();
    });
    vapi.on("call-end", () => {
      clearConnectionTimer();
      clearConnectionWarningTimer();
      clearInactivityTimers();
      clearPartialTimer();
      const endedBeforeConnect = !sessionStateRef.current.hasConnected && sessionStateRef.current.status === "connecting";
      applySessionEvent({ type: "call-end" });
      if (endedBeforeConnect) {
        setError(`${getVapiAssistantConfigHint(Boolean(assistantId))} The call ended before Vapi emitted call-start.`);
      }
      setVolume(0.08);
      void finishClientSession();
    });
    vapi.on("volume-level", (level: number) => setVolume(Math.max(0.06, Math.min(1, level))));
    vapi.on("message", (message: any) => {
      if (statusRef.current === "active") armInactivityWatchdog();
      extractVapiToolEvents(message).forEach((toolEvent) => {
        applySessionEvent({ type: "tool-call", name: toolEvent.name, result: toolEvent.result, arguments: toolEvent.arguments });
      });
      if (message?.type === "transcript" && message.transcript) {
        const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : undefined;
        if (!role) return;
        if (message.transcriptType === "partial") {
          clearPartialTimer();
          applySessionEvent({ type: "partial-transcript", role, text: message.transcript });
          partialTimerRef.current = window.setTimeout(() => {
            applySessionEvent({ type: "pause", role });
            partialTimerRef.current = null;
          }, runtimeEndpointingRef.current);
          return;
        }
        clearPartialTimer();
        applySessionEvent({ type: "transcript", role, text: message.transcript });
      }
      if (message?.type === "status-update" && message.status === "ended") {
        clearInactivityTimers();
        applySessionEvent({ type: "call-end" });
        void finishClientSession();
      }
    });
    vapi.on("error", (event: unknown) => {
      const readableError = formatVapiError(event);
      console.warn(`[Vapi] ${readableError}`);
      applySessionEvent({ type: "error", message: readableError });
    });

    return () => {
      clearConnectionTimer();
      clearConnectionWarningTimer();
      clearInactivityTimers();
      clearPartialTimer();
      vapi.stop();
      vapi.removeAllListeners();
    };
  }, []);

  const canStart = Boolean(publicKey && runtimeConfig);
  // Surfaced before the call rather than after: an unreachable tool webhook does not
  // raise an error anywhere, it just makes every lookup silently never return.
  const toolServerUrl = typeof window === "undefined" ? "" : resolveToolServerUrl(window.location.origin, publicServerUrl);
  const statusLabel = {
    idle: "Ready when you are",
    connecting: "Opening a secure voice session",
    active: "Sarah is listening",
    ended: "Session ended"
  }[status];

  const lastProgressMessage = () => {
    const last = sessionStateRef.current.transcript.at(-1);
    const configured = runtimeConfig?.inactivityPromptMessage;
    if (configured) return configured.replace("{lastMessage}", last?.text || "our last message");
    if (last?.role === "assistant") return "I haven’t heard back. Are you still there, or would you like me to continue?";
    return "I’m still here. Would you like me to continue with that?";
  };
  const finishClientSession = async (sayGoodbye = false) => {
    clearConnectionTimer(); clearConnectionWarningTimer(); clearInactivityTimers(); clearPartialTimer();
    const lines = sessionStateRef.current.transcript;
    if (sayGoodbye) {
      (vapiRef.current as any)?.say?.(runtimeConfig?.goodbyeMessage || "Thanks for calling. Have a great day.", true);
      await new Promise((resolve) => window.setTimeout(resolve, runtimeConfig?.goodbyeDelayMs ?? 900));
    }
    // Backend end-of-call events are the authoritative interaction logger.
  };
  const armInactivityWatchdog = () => {
    if (!runtimeConfig || statusRef.current !== "active") return;
    clearInactivityTimers();
    inactivityPromptTimerRef.current = window.setTimeout(() => {
      if (statusRef.current !== "active") return;
      (vapiRef.current as any)?.say?.(lastProgressMessage(), true);
      inactivityTimeoutTimerRef.current = window.setTimeout(() => {
        if (statusRef.current !== "active") return;
        (vapiRef.current as any)?.say?.(runtimeConfig.inactivityTimeoutMessage, true);
        vapiRef.current?.stop();
        applySessionEvent({ type: "timeout", message: runtimeConfig.inactivityTimeoutMessage });
        void finishClientSession();
      }, Math.max(0, runtimeConfig.inactivityTimeoutMs - runtimeConfig.inactivityPromptAfterMs));
    }, runtimeConfig.inactivityPromptAfterMs);
  };

  const startCall = async () => {
    if (!vapiRef.current || !publicKey) {
      setError("Vapi is not configured yet. Add VITE_VAPI_PUBLIC_KEY to enable live voice.");
      return;
    }
    if (!runtimeConfig) {
      setError("Voice runtime configuration is still loading. Please try again in a moment.");
      return;
    }
    try {
      applySessionEvent({ type: "start" });
      clearConnectionTimer(); clearConnectionWarningTimer(); clearInactivityTimers(); clearPartialTimer();
      connectionWarningTimerRef.current = window.setTimeout(() => {
        if (statusRef.current === "connecting") (vapiRef.current as any)?.say?.("I’m still connecting you. One more moment, please.", true);
      }, runtimeConfig.connectTimeoutWarningMs);
      connectionTimerRef.current = window.setTimeout(() => {
        if (statusRef.current !== "connecting") return;
        vapiRef.current?.stop();
        applySessionEvent({ type: "timeout", message: `${getVapiAssistantConfigHint(Boolean(assistantId))} The connection timed out after ${runtimeConfig.connectTimeoutMs / 1000} seconds.` });
        void finishClientSession();
      }, runtimeConfig.connectTimeoutMs);
      if (assistantId) {
        await vapiRef.current.start(assistantId);
      } else {
        await vapiRef.current.start(createAssistantConfig(
          tenant?.systemPrompt || systemPrompt,
          runtimeConfig.endpointingMs,
          tenant?.tools || [],
          { model: runtimeConfig.model, voice: runtimeConfig.voice, transcriber: runtimeConfig.transcriber },
          tenant?.firstMessage || defaultFirstMessage,
        ) as any);
      }
    } catch (err) {
      clearConnectionTimer();
      clearConnectionWarningTimer();
      clearInactivityTimers();
      const readableError = formatVapiError(err);
      console.warn(`[Vapi] ${readableError}`);
      applySessionEvent({ type: "error", message: readableError });
    }
  };

  const endCall = async () => {
    if (statusRef.current === "idle" || statusRef.current === "ended") return;
    await finishClientSession(true);
    vapiRef.current?.stop();
    applySessionEvent({ type: "call-end" });
  };
  const toggleMute = () => {
    const next = !isMuted;
    vapiRef.current?.setMuted(next);
    setIsMuted(next);
  };

  const pulseStyle = useMemo(() => ({ transform: `scale(${1 + volume * 0.35})`, opacity: Math.min(0.95, 0.45 + volume * 0.5) }), [volume]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f8f6fb] text-[#4b4661]">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[34rem] w-[34rem] rounded-full bg-[#dcd4f4]/65 blur-3xl" />
        <div className="absolute right-[-10rem] top-[12%] h-[30rem] w-[30rem] rounded-full bg-[#f5dce7]/70 blur-3xl" />
        <div className="absolute bottom-[-16rem] left-[27%] h-[38rem] w-[38rem] rounded-full bg-[#d8eee3]/70 blur-3xl" />
        <div className="absolute inset-x-[17%] top-0 h-full border-x border-[#ffffff]/60" />
      </div>

      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-7 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full border border-[#8c84ad]/40 bg-white/50 shadow-sm backdrop-blur"><span className="font-serif text-xl text-[#6e678d]">o</span></div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#77718d]">Observe</div>
            <div className="-mt-1 font-serif text-lg text-[#57516f]">Insurance</div>
          </div>
        </div>
        <nav className="hidden items-center gap-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#888298] md:flex">
          <a href="#support" className="transition hover:text-[#57516f]">Voice support</a>
          <a href="#process" className="transition hover:text-[#57516f]">Our promise</a>
          <a href="#faq" className="transition hover:text-[#57516f]">FAQs</a>
        </nav>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7f7893]"><ShieldCheck className="h-4 w-4" /> Private by design</div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl gap-16 px-6 pb-24 pt-12 lg:grid-cols-[1fr_0.92fr] lg:items-center lg:px-10 lg:pb-32 lg:pt-20">
          <div className="relative">
            <div className="mb-8 flex items-center gap-4 text-[10px] font-semibold uppercase tracking-[0.32em] text-[#8e88a0]"><span className="h-px w-12 bg-[#9f98b4]" /> A quieter way to get answers</div>
            <h1 className="max-w-2xl font-serif text-6xl leading-[0.98] tracking-[-0.045em] text-[#504a68] sm:text-7xl lg:text-[6.9rem]">Support that <em className="font-normal text-[#9387ac]">meets</em> you where you are.</h1>
            <p className="mt-9 max-w-lg text-base leading-8 text-[#77718d]">Connect with Sarah, our AI Claims Support Agent, for calm, conversational help with your claim. No waiting on hold. No forms to find. Just a clear next step, whenever you need it.</p>
            <div className="mt-10 flex flex-wrap items-center gap-5">
              <Button onClick={startCall} disabled={status === "connecting" || status === "active"} className="group h-14 rounded-full bg-[#625b7b] px-7 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-[0_14px_35px_rgba(98,91,123,0.22)] transition hover:-translate-y-0.5 hover:bg-[#524b6b] active:scale-[0.98]">
                <Mic className="mr-3 h-4 w-4" /> {status === "connecting" ? "Connecting" : "Start voice support"}<ArrowUpRight className="ml-3 h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Button>
              <span className="text-[11px] uppercase tracking-[0.17em] text-[#938da2]">Browser-based · No phone required</span>
            </div>
            <div className="mt-14 flex items-center gap-8 text-[11px] uppercase tracking-[0.14em] text-[#918aa0]"><span><strong className="font-semibold text-[#676078]">24/7</strong> guided support</span><span className="h-4 w-px bg-[#b9b2c4]" /><span><strong className="font-semibold text-[#676078]">1:1</strong> conversational care</span></div>
            <span className="absolute -left-4 top-[-4rem] hidden h-24 w-24 border-l border-t border-[#9f98b4]/45 lg:block" />
          </div>

          <Card id="support" className="relative overflow-hidden rounded-[2rem] border border-white/75 bg-white/45 p-4 shadow-[0_28px_90px_rgba(107,92,130,0.13)] backdrop-blur-xl sm:p-6">
            <div className="absolute right-8 top-8 h-20 w-20 border-r border-t border-[#a7a0b8]/35" />
            <div className="rounded-[1.5rem] border border-white/80 bg-[#faf9fc]/75 p-5 sm:p-7">
              <div className="flex items-start justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[0.27em] text-[#9a93a9]">Live voice room</div><h2 className="mt-2 font-serif text-3xl text-[#5c5574]">Hello, I’m Sarah.</h2></div><Badge variant="outline" className="rounded-full border-[#cfc8dc] bg-white/60 px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-[#807993]"><span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${status === "active" ? "bg-[#8fb9a6]" : "bg-[#c7c0d1]"}`} /> {statusLabel}</Badge></div>
              <div className="relative my-8 grid min-h-[11rem] place-items-center overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-[#ede9f8] via-[#f7edf4] to-[#e5f2ec]">
                <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(90deg, transparent 49.8%, rgba(128,119,155,.15) 50%, transparent 50.2%), linear-gradient(rgba(128,119,155,.1) 1px, transparent 1px)", backgroundSize: "100% 100%, 100% 28px" }} />
                <div className="relative grid h-28 w-28 place-items-center rounded-full border border-white/85 bg-white/35 shadow-[0_0_0_18px_rgba(255,255,255,0.16),0_0_0_36px_rgba(255,255,255,0.1)] transition-transform duration-300" style={pulseStyle}><div className="grid h-16 w-16 place-items-center rounded-full bg-[#746a92] text-white shadow-lg"><Volume2 className="h-7 w-7" /></div></div>
                <div className="absolute bottom-4 flex items-end gap-1"><span className="h-2 w-1 rounded-full bg-[#8b819f]/60" /><span className="h-5 w-1 rounded-full bg-[#8b819f]/70" /><span className="h-3 w-1 rounded-full bg-[#8b819f]/50" /><span className="h-7 w-1 rounded-full bg-[#8b819f]/80" /><span className="h-4 w-1 rounded-full bg-[#8b819f]/60" /><span className="h-2 w-1 rounded-full bg-[#8b819f]/50" /></div>
              </div>

              <TranscriptPanel transcript={transcript} pending={pendingTranscript} />

              {toolEvents.length > 0 && <div className="mt-4 rounded-xl border border-[#e6e0ed] bg-white/45 px-4 py-3"><div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#9a93a9]">Tool activity</div><div className="mt-2 space-y-1.5">{toolEvents.slice(-4).map((event, index) => <div key={`${event.name}-${index}`} className="flex items-center justify-between gap-3 text-[11px] text-[#766f87]"><span className="font-mono text-[#625b7b]">{event.name}</span><span className="truncate text-right text-[#9891a5]">{describeToolEvent(event)}</span></div>)}</div></div>}

              {webhookHealth && !webhookHealth.reachable && (
                <div className="mt-4 rounded-xl border border-[#e6d8bd] bg-[#fdf8ee] px-4 py-3 text-sm leading-6 text-[#8a7444]">
                  <strong className="font-semibold">Claim lookups will not work.</strong>{" "}
                  {webhookHealth.reason === "local" ? (
                    <>Vapi calls tools from its own cloud and cannot reach a local address. Start a tunnel and set{" "}
                      <code className="rounded bg-white/70 px-1 font-mono text-[12px]">VITE_PUBLIC_SERVER_URL</code>.</>
                  ) : assistantId ? (
                    <>The tool webhook did not respond, so the URL registered with the Vapi assistant is stale.
                      Restart <code className="rounded bg-white/70 px-1 font-mono text-[12px]">cloudflared</code>, update{" "}
                      <code className="rounded bg-white/70 px-1 font-mono text-[12px]">VITE_PUBLIC_SERVER_URL</code>, then re-run{" "}
                      <code className="rounded bg-white/70 px-1 font-mono text-[12px]">node scripts/provisionVapi.mjs</code> — the registered
                      copy lives in Vapi, so editing .env alone is not enough.</>
                  ) : (
                    <>The tool webhook did not respond. The tunnel is probably down or has a new hostname — restart{" "}
                      <code className="rounded bg-white/70 px-1 font-mono text-[12px]">cloudflared</code>, update{" "}
                      <code className="rounded bg-white/70 px-1 font-mono text-[12px]">VITE_PUBLIC_SERVER_URL</code>, then reload this page.</>
                  )}
                  <div className="mt-1 break-all font-mono text-[11px] opacity-70">{toolServerUrl}</div>
                </div>
              )}

              {error && <div className="mt-4 rounded-xl border border-[#e8c8d1] bg-[#fff4f6] px-4 py-3 text-sm leading-6 text-[#9d6474]">{error}</div>}
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#e4dfeb] pt-5"><div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#9891a5]"><span className="h-2 w-2 rounded-full bg-[#9fc0ad]" /> Voice session {publicKey ? "available" : "needs setup"}</div><div className="flex gap-2">{status === "active" && <Button onClick={toggleMute} variant="outline" className="h-10 w-10 rounded-full border-[#d6d0df] bg-white/70 p-0 text-[#6b6380] hover:bg-white">{isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</Button>}{status === "active" ? <Button onClick={endCall} className="h-10 rounded-full bg-[#b67e8f] px-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white hover:bg-[#a96f82]"><PhoneOff className="mr-2 h-3.5 w-3.5" /> End session</Button> : <Button onClick={startCall} disabled={status === "connecting"} className="h-10 rounded-full bg-[#625b7b] px-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white hover:bg-[#524b6b]"><Phone className="mr-2 h-3.5 w-3.5" /> {status === "connecting" ? "Connecting" : "Begin"}</Button>}</div></div>
            </div>
          </Card>
        </section>

        <section id="process" className="border-y border-white/65 bg-white/20 px-6 py-20 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-end"><div><div className="mb-5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9a93a8]">Designed around you</div><h2 className="max-w-md font-serif text-5xl leading-none tracking-[-0.035em] text-[#5d5675]">Clear answers, <em className="font-normal text-[#a08eae]">without</em> the friction.</h2></div><p className="max-w-xl text-base leading-8 text-[#7e778f]">Sarah uses a configurable voice workflow that can authenticate a caller, access approved tools, explain the next step, and record the interaction. Today she supports insurance claims; the same service foundation can power any support experience.</p></div><div className="mt-14 grid gap-4 md:grid-cols-3"><div className="border-l border-[#a8a0b6]/60 pl-5"><div className="font-serif text-3xl text-[#70678a]">01</div><h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-[#655e79]">Listen first</h3><p className="mt-3 text-sm leading-6 text-[#8a8397]">Speak naturally. Sarah listens for intent and only asks for the information needed to help.</p></div><div className="border-l border-[#a8a0b6]/60 pl-5"><div className="font-serif text-3xl text-[#70678a]">02</div><h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-[#655e79]">Verify securely</h3><p className="mt-3 text-sm leading-6 text-[#8a8397]">Identity checks are capped at two attempts before a human handoff is offered.</p></div><div className="border-l border-[#a8a0b6]/60 pl-5"><div className="font-serif text-3xl text-[#70678a]">03</div><h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-[#655e79]">Leave with clarity</h3><p className="mt-3 text-sm leading-6 text-[#8a8397]">You receive the status, required next steps, and a concise record of the conversation.</p></div></div></div></section>

        <section id="faq" className="mx-auto max-w-7xl px-6 py-20 lg:px-10"><div className="flex flex-col justify-between gap-8 md:flex-row md:items-end"><div><div className="mb-5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9a93a8]">Before we begin</div><h2 className="font-serif text-5xl tracking-[-0.035em] text-[#5d5675]">A few helpful answers.</h2></div><Button variant="outline" onClick={() => setShowFaq((v) => !v)} className="w-fit rounded-full border-[#cfc8db] bg-white/40 px-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#706983] hover:bg-white/70">{showFaq ? "Close FAQs" : "View FAQs"}<ArrowUpRight className="ml-2 h-3.5 w-3.5" /></Button></div>{showFaq && <div className="mt-10 grid gap-4 md:grid-cols-2">{(tenant?.faqs || []).map((faq: { question: string; answer: string }) => <div key={faq.question} className="rounded-2xl border border-white/80 bg-white/40 p-6"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#9a8dad]" /><div><h3 className="text-sm font-semibold text-[#645d77]">{faq.question}</h3><p className="mt-2 text-sm leading-6 text-[#8b8398]">{faq.answer}</p></div></div></div>)}</div>}</section>
      </main>

      <footer className="border-t border-white/70 px-6 py-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9b94a8] sm:flex-row"><span>Observe Insurance · Support with clarity</span><span className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Sarah · AI Claims Support Agent</span></div></footer>
    </div>
  );
}
