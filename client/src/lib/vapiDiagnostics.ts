export type VapiErrorLike = {
  message?: unknown;
  error?: unknown;
  stage?: unknown;
  endedReason?: unknown;
  code?: unknown;
  [key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

export function formatVapiError(value: unknown): string {
  const root = asRecord(value);
  const nested = asRecord(root?.error);
  const message = firstText(
    root?.message,
    nested?.message,
    root?.endedReason,
    nested?.endedReason,
    root?.code,
    nested?.code,
  );
  const normalized = message?.toLowerCase() ?? "";
  const serialized = (() => {
    try { return JSON.stringify(value).toLowerCase(); } catch { return ""; }
  })();

  // Provider-level quotas are metered separately from the Vapi wallet balance, so an
  // account with credits remaining still gets cut off here. Say that explicitly —
  // "limit reached" alongside a funded account otherwise reads as a bug in this app.
  if (
    normalized.includes("exceeded_total_minutes") ||
    normalized.includes("quota-exceeded") ||
    normalized.includes("out-of-credits") ||
    normalized.includes("daily-error") ||
    serialized.includes("exceeded_total_minutes") ||
    serialized.includes("quota-exceeded") ||
    serialized.includes("out-of-credits") ||
    serialized.includes("daily-error")
  ) {
    return "The voice provider ended the session: its minute quota is exhausted. This is metered separately from your Vapi credit balance, so credits remaining in your account will not lift it. Attach your own transcriber/voice provider keys in the Vapi dashboard, or raise the quota on the Vapi plan. The call ended before any audio was processed, so there was no transcript to normalize or look up — this is not a lookup failure.";
  }

  if (normalized.includes("insufficient-credits") || serialized.includes("insufficient-credits")) {
    return "Vapi rejected the call because the account credit balance is too low to start a session. Add credits or enable auto-reload in the Vapi dashboard.";
  }

  if (normalized.includes("concurrency-limit") || serialized.includes("concurrency-limit")) {
    return "Vapi rejected the call because the plan's simultaneous-call limit is in use. Wait for the other session to end, or upgrade the plan.";
  }

  if (normalized.includes("meeting has ended") || normalized.includes("ejection") || serialized.includes("meeting has ended")) {
    return "Vapi ended the session before it connected. Check the provider voice-minute limit, Vapi assistant configuration, and provider credentials, then try again.";
  }

  if (message) return `Vapi could not start the session: ${message}`;

  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}"
      ? `Vapi could not start the session: ${serialized}`
      : "Vapi could not start the session. Please check the browser microphone permission and assistant configuration.";
  } catch {
    return "Vapi could not start the session. Please check the browser microphone permission and assistant configuration.";
  }
}

export function isPreConnectVapiFailure(status: "idle" | "connecting" | "active" | "ended"): boolean {
  return status === "connecting";
}

export function getVapiAssistantConfigHint(hasAssistantId: boolean): string {
  return hasAssistantId
    ? "The configured assistant could not connect. Check its model, voice, transcriber, and Vapi credentials."
    : "No Vapi assistant ID is configured. The inline assistant requires an enabled Vapi model and voice provider.";
}
