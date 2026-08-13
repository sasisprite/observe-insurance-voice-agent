export type VapiSessionStatus = "idle" | "connecting" | "active" | "ended";
export type VapiTranscriptRole = "user" | "assistant";

export type VapiAuthStage = "idle" | "awaiting_identifier" | "awaiting_verification" | "authenticated";

export type VapiToolEvent = {
  id?: string;
  name: string;
  result?: unknown;
  arguments?: unknown;
};

export type VapiSessionState = {
  status: VapiSessionStatus;
  hasConnected: boolean;
  error: string | null;
  authStage: VapiAuthStage;
  transcript: Array<{ role: VapiTranscriptRole; text: string }>;
  pendingTranscript: { role: VapiTranscriptRole; text: string } | null;
  transcriptBreakPending: boolean;
  toolEvents: VapiToolEvent[];
};

export type VapiSessionEvent =
  | { type: "start" }
  | { type: "call-start" }
  | { type: "call-end" }
  | { type: "error"; message: string }
  | { type: "timeout"; message: string }
  | { type: "partial-transcript"; role: VapiTranscriptRole; text: string }
  | { type: "pause"; role: VapiTranscriptRole }
  | { type: "auth-stage"; stage: VapiAuthStage }
  | ({ type: "tool-call" } & VapiToolEvent)
  | { type: "transcript"; role: VapiTranscriptRole; text: string };

export const initialVapiSessionState: VapiSessionState = {
  status: "idle",
  hasConnected: false,
  error: null,
  authStage: "idle",
  transcript: [],
  pendingTranscript: null,
  transcriptBreakPending: false,
  toolEvents: [],
};

function parseToolPayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stableToolPayload(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isSameToolInvocation(left: VapiToolEvent, right: VapiToolEvent): boolean {
  if (left.id && right.id) return left.id === right.id;
  return left.name === right.name && stableToolPayload(left.arguments) === stableToolPayload(right.arguments);
}

function cleanTranscriptText(text: string): string {
  return text.trim().replace(/[\t ]+/g, " ");
}

function endsWithSentenceBoundary(text: string): boolean {
  return /[.!?。！？]$/.test(text.trim());
}

function startsWithSentence(text: string): boolean {
  return /^[A-ZÀ-ÖØ-ÞА-ЯЁ0-9]/.test(text.trim());
}

function isIdentifierContinuation(previousText: string, nextText: string): boolean {
  const previous = previousText.toLowerCase().replace(/[\t ]+/g, " ").trim();
  const next = nextText.toLowerCase().trim();
  const startsIdentifierPart = /^(?:c\s*u\s*s\s*t|cust|hyphen|[-\d]|zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/.test(next);
  return startsIdentifierPart && /(?:customer|account|client)?\s*id(?:entifier)?(?:\s+is)?$/.test(previous)
    || startsIdentifierPart && /(?:c\s*u\s*s\s*t|cust)$/.test(previous);
}

function appendTranscriptSegment(
  transcript: Array<{ role: VapiTranscriptRole; text: string }>,
  next: { role: VapiTranscriptRole; text: string },
  forceNewLine = false,
): Array<{ role: VapiTranscriptRole; text: string }> {
  const text = cleanTranscriptText(next.text);
  if (!text) return transcript;
  const previous = transcript[transcript.length - 1];
  const canMerge = previous && previous.role === next.role && (!forceNewLine || isIdentifierContinuation(previous.text, text));
  const startsMeaningfulNewSentence = Boolean(previous && endsWithSentenceBoundary(previous.text) && startsWithSentence(text));

  if (canMerge && !startsMeaningfulNewSentence) {
    return [...transcript.slice(0, -1), { ...previous, text: `${previous.text} ${text}` }].slice(-20);
  }
  return [...transcript.slice(-19), { role: next.role, text }];
}

/** Merge provider transcript fragments without turning every recognizer chunk into a new bubble. */
export function appendTranscriptLine(
  transcript: Array<{ role: VapiTranscriptRole; text: string }>,
  next: { role: VapiTranscriptRole; text: string },
  forceNewLine = false,
): Array<{ role: VapiTranscriptRole; text: string }> {
  const segments = next.text.split(/\n{1,2}/).map(cleanTranscriptText).filter(Boolean);
  return segments.reduce((result, segment, index) => appendTranscriptSegment(result, { role: next.role, text: segment }, forceNewLine || index > 0), transcript);
}

export function reduceVapiSession(state: VapiSessionState, event: VapiSessionEvent): VapiSessionState {
  switch (event.type) {
    case "start":
      return {
        ...state,
        status: "connecting",
        hasConnected: false,
        error: null,
        authStage: "awaiting_identifier",
        transcript: [],
        pendingTranscript: null,
        transcriptBreakPending: false,
        toolEvents: [],
      };
    case "call-start":
      return { ...state, status: "active", hasConnected: true, error: null, authStage: "awaiting_identifier", pendingTranscript: null, transcriptBreakPending: false };
    case "call-end":
      return {
        ...state,
        status: "ended",
        // Drop any in-flight recognizer text so a half-finished turn does not linger
        // on screen after the call is over.
        pendingTranscript: null,
        error: state.error ?? (!state.hasConnected && state.status === "connecting" ? "The Vapi call ended before the browser session connected." : null),
      };
    case "error":
      return { ...state, status: "ended", error: event.message, pendingTranscript: null };
    case "timeout":
      return { ...state, status: "ended", error: event.message, pendingTranscript: null };
    case "partial-transcript":
      return event.text.trim() ? { ...state, pendingTranscript: { role: event.role, text: event.text }, transcriptBreakPending: false } : state;
    case "pause":
      return { ...state, transcriptBreakPending: true };
    case "auth-stage":
      return { ...state, authStage: event.stage };
    case "tool-call": {
      const nextStage = authStageFromToolEvent(event.name, event.result);
      const nextEvent: VapiToolEvent = {
        ...(event.id ? { id: event.id } : {}),
        name: event.name,
        result: event.result,
        arguments: event.arguments,
      };
      const existingIndex = state.toolEvents.findIndex((item) => isSameToolInvocation(item, nextEvent));
      const toolEvents = existingIndex === -1
        ? [...state.toolEvents.slice(-9), nextEvent]
        : state.toolEvents.map((item, index) => {
          if (index !== existingIndex) return item;
          return event.result === undefined || stableToolPayload(item.result) === stableToolPayload(event.result)
            ? item
            : { ...item, ...nextEvent, arguments: nextEvent.arguments ?? item.arguments };
        });
      return {
        ...state,
        ...(nextStage ? { authStage: nextStage } : {}),
        toolEvents,
      };
    }
    case "transcript":
      return event.text.trim()
        ? { ...state, pendingTranscript: null, transcriptBreakPending: false, transcript: appendTranscriptLine(state.transcript, { role: event.role, text: event.text }, state.transcriptBreakPending) }
        : state;
  }
}

export function extractVapiToolEvents(message: unknown): VapiToolEvent[] {
  if (!message || typeof message !== "object") return [];
  const payload = message as Record<string, unknown>;
  const candidateLists = [
    payload.toolCallList,
    payload.toolCallResults,
    payload.toolCalls,
  ].filter(Array.isArray) as unknown[][];
  const candidates = candidateLists.flat();
  if (payload.toolCall) candidates.push(payload.toolCall);
  if (payload.toolCallResult) candidates.push(payload.toolCallResult);

  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const fn = item.function && typeof item.function === "object" ? item.function as Record<string, unknown> : undefined;
    const name = typeof item.name === "string"
      ? item.name
      : typeof fn?.name === "string"
        ? fn.name
        : typeof item.toolName === "string"
          ? item.toolName
          : undefined;
    if (!name) return [];
    const rawResult = item.result ?? item.output ?? payload.result ?? payload.toolCallResult;
    const args = fn?.arguments ?? item.arguments ?? item.parameters;
    return [{
      ...(typeof item.id === "string" ? { id: item.id } : typeof item.toolCallId === "string" ? { id: item.toolCallId } : {}),
      name,
      ...(rawResult !== undefined ? { result: parseToolPayload(rawResult) } : {}),
      ...(args !== undefined ? { arguments: parseToolPayload(args) } : {}),
    }];
  });
}

export function authStageFromToolEvent(name: string, result?: unknown): VapiAuthStage | null {
  const payload = parseToolPayload(result);
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (name === "begin_tenant_lookup") {
    if (data.status === "not_found") return "awaiting_identifier";
    if (data.status === "verification_required") return "awaiting_verification";
    return null;
  }
  if (name !== "verify_tenant_record") return null;

  if (data.status === "success" || data.status === "authenticated" || data.authenticated === true) return "authenticated";
  if (data.status === "auth_failure" || data.status === "verification_required") return "awaiting_verification";
  if (data.status === "not_found") return "awaiting_identifier";
  return null;
}

export function isConnecting(state: VapiSessionState): boolean {
  return state.status === "connecting" && !state.hasConnected;
}
