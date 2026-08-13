import { describe, expect, it } from "vitest";
import {
  authStageFromToolEvent,
  extractVapiToolEvents,
  initialVapiSessionState,
  isConnecting,
  reduceVapiSession,
} from "./vapiSession";

describe("vapi session lifecycle", () => {
  it("enters connecting and clears stale session data on start", () => {
    const stale = reduceVapiSession(initialVapiSessionState, { type: "transcript", role: "user", text: "old" });
    const next = reduceVapiSession({ ...stale, status: "ended", error: "old error" }, { type: "start" });

    expect(next).toMatchObject({ status: "connecting", hasConnected: false, error: null, transcript: [] });
    expect(isConnecting(next)).toBe(true);
  });

  it("moves to active and records that the call connected", () => {
    const connecting = reduceVapiSession(initialVapiSessionState, { type: "start" });
    const active = reduceVapiSession(connecting, { type: "call-start" });

    expect(active).toMatchObject({ status: "active", hasConnected: true, error: null });
    expect(isConnecting(active)).toBe(false);
  });

  it("creates a readable pre-connect failure when Vapi ends early", () => {
    const connecting = reduceVapiSession(initialVapiSessionState, { type: "start" });
    const ended = reduceVapiSession(connecting, { type: "call-end" });

    expect(ended.status).toBe("ended");
    expect(ended.error).toContain("before the browser session connected");
  });

  it("preserves a specific Vapi error over the generic end message", () => {
    const connecting = reduceVapiSession(initialVapiSessionState, { type: "start" });
    const errored = reduceVapiSession(connecting, { type: "error", message: "Vapi could not start the session: microphone denied" });
    const ended = reduceVapiSession(errored, { type: "call-end" });

    expect(errored).toMatchObject({ status: "ended", error: "Vapi could not start the session: microphone denied" });
    expect(ended.error).toBe("Vapi could not start the session: microphone denied");
  });

  it("ends a stalled connection on timeout", () => {
    const connecting = reduceVapiSession(initialVapiSessionState, { type: "start" });
    const timedOut = reduceVapiSession(connecting, { type: "timeout", message: "The connection timed out after 20 seconds." });

    expect(timedOut).toMatchObject({ status: "ended", hasConnected: false, error: "The connection timed out after 20 seconds." });
  });

  it("merges adjacent same-speaker fragments into one readable message", () => {
    let state = initialVapiSessionState;
    state = reduceVapiSession(state, { type: "transcript", role: "user", text: "c u s t" });
    state = reduceVapiSession(state, { type: "transcript", role: "user", text: "hyphen 1 0 0 4 2" });

    expect(state.transcript).toEqual([{ role: "user", text: "c u s t hyphen 1 0 0 4 2" }]);
  });

  it("starts a new row after a sentence boundary and preserves explicit paragraphs", () => {
    let state = initialVapiSessionState;
    state = reduceVapiSession(state, { type: "transcript", role: "assistant", text: "I found your account." });
    state = reduceVapiSession(state, { type: "transcript", role: "assistant", text: "\nNow I need one verification detail." });

    expect(state.transcript).toEqual([
      { role: "assistant", text: "I found your account." },
      { role: "assistant", text: "Now I need one verification detail." },
    ]);
  });

  it("keeps only the most recent twenty final transcript lines", () => {
    let state = initialVapiSessionState;
    for (let index = 0; index < 22; index += 1) {
      state = reduceVapiSession(state, { type: "transcript", role: "user", text: `Turn ${index}.` });
    }

    expect(state.transcript).toHaveLength(20);
    expect(state.transcript[0]?.text).toBe("Turn 2.");
    expect(state.transcript[19]?.text).toBe("Turn 21.");
  });

  it("respects pause boundaries for normal speech while keeping identifier spellings together", () => {
    let state = initialVapiSessionState;
    state = reduceVapiSession(state, { type: "transcript", role: "user", text: "Hello Sarah." });
    state = reduceVapiSession(state, { type: "pause", role: "user" });
    state = reduceVapiSession(state, { type: "transcript", role: "user", text: "I need help with my claim." });

    expect(state.transcript).toEqual([
      { role: "user", text: "Hello Sarah." },
      { role: "user", text: "I need help with my claim." },
    ]);
  });

  it("preserves a paused partial and replaces it when the caller corrects themselves", () => {
    let state = reduceVapiSession(initialVapiSessionState, { type: "start" });
    state = reduceVapiSession(state, { type: "call-start" });
    state = reduceVapiSession(state, { type: "partial-transcript", role: "user", text: "five five five two" });
    state = reduceVapiSession(state, { type: "pause", role: "user" });

    expect(state.transcript).toEqual([]);
    expect(state.pendingTranscript).toEqual({ role: "user", text: "five five five two" });

    state = reduceVapiSession(state, { type: "partial-transcript", role: "user", text: "five five five two three four" });
    expect(state.pendingTranscript?.text).toBe("five five five two three four");

    state = reduceVapiSession(state, { type: "transcript", role: "user", text: "five five five two three four" });
    expect(state.pendingTranscript).toBeNull();
    expect(state.transcript[0]?.text).toBe("five five five two three four");
  });

  it("models the identifier-first, verification-second authentication sequence", () => {
    let state = reduceVapiSession(initialVapiSessionState, { type: "start" });
    expect(state.authStage).toBe("awaiting_identifier");

    state = reduceVapiSession(state, { type: "auth-stage", stage: "awaiting_verification" });
    expect(state.authStage).toBe("awaiting_verification");

    state = reduceVapiSession(state, { type: "auth-stage", stage: "authenticated" });
    expect(state.authStage).toBe("authenticated");
  });

  it("maps actual Vapi tool messages into the authentication state machine", () => {
    const beginMessage = { type: "tool-calls", toolCallList: [{ function: { name: "begin_tenant_lookup" } }] };
    const verifyMessage = { type: "tool-result", toolCall: { name: "verify_tenant_record", result: { status: "authenticated" } } };

    expect(extractVapiToolEvents(beginMessage)).toEqual([{ name: "begin_tenant_lookup", result: undefined }]);
    expect(extractVapiToolEvents(verifyMessage)).toEqual([{ name: "verify_tenant_record", result: { status: "authenticated" } }]);

    let state = reduceVapiSession(reduceVapiSession(initialVapiSessionState, { type: "start" }), { type: "call-start" });
    for (const event of [...extractVapiToolEvents(beginMessage), ...extractVapiToolEvents(verifyMessage)]) {
      state = reduceVapiSession(state, { type: "tool-call", ...event });
    }

    expect(authStageFromToolEvent("verify_tenant_record", { status: "authenticated" })).toBe("authenticated");
    expect(state.authStage).toBe("authenticated");
    expect(state.toolEvents).toHaveLength(2);
  });

  it("does not advance to verification when the identifier is not found", () => {
    expect(authStageFromToolEvent("begin_tenant_lookup", { status: "not_found" })).toBe("awaiting_identifier");
  });

  it("keeps the caller in verification after a failed verification attempt", () => {
    expect(authStageFromToolEvent("verify_tenant_record", { status: "auth_failure" })).toBe("awaiting_verification");
    expect(authStageFromToolEvent("verify_tenant_record", { status: "not_found" })).toBe("awaiting_identifier");
  });

  it("retains tool arguments for visible debugging", () => {
    const argumentsPayload = JSON.stringify({ rawIdentifier: "CUST-10042" });
    const message = { type: "tool-calls", toolCallList: [{ function: { name: "normalize_identifier", arguments: argumentsPayload } }] };
    expect(extractVapiToolEvents(message)).toEqual([{ name: "normalize_identifier", arguments: { rawIdentifier: "CUST-10042" } }]);
  });

  it("parses JSON-string tool results so the normalized identifier reaches the auth state machine", () => {
    const message = {
      type: "tool-result",
      toolCall: {
        name: "begin_tenant_lookup",
        result: JSON.stringify({ status: "verification_required", identifier: "+1 (555) 234-5678" }),
      },
    };
    const [event] = extractVapiToolEvents(message);
    expect(event).toEqual({
      name: "begin_tenant_lookup",
      result: { status: "verification_required", identifier: "+1 (555) 234-5678" },
    });
    expect(authStageFromToolEvent(event.name, event.result)).toBe("awaiting_verification");
  });

  it("reads a result from a Vapi toolCallResults batch", () => {
    const message = {
      type: "tool-results",
      toolCallResults: [{ toolName: "normalize_identifier", output: JSON.stringify({ normalizedIdentifier: "cust-10042" }) }],
    };
    expect(extractVapiToolEvents(message)).toEqual([{
      name: "normalize_identifier",
      result: { normalizedIdentifier: "cust-10042" },
    }]);
  });

  it("replaces a pending Vapi tool invocation with its result instead of rendering duplicate activity", () => {
    let state = reduceVapiSession(initialVapiSessionState, {
      type: "tool-call",
      id: "tool-cust-10042",
      name: "begin_tenant_lookup",
      arguments: { identifier: "cust-10042" },
    });
    state = reduceVapiSession(state, {
      type: "tool-call",
      id: "tool-cust-10042",
      name: "begin_tenant_lookup",
      arguments: { identifier: "cust-10042" },
      result: { status: "verification_required", customerId: "CUST-10042" },
    });

    expect(state.toolEvents).toEqual([{
      id: "tool-cust-10042",
      name: "begin_tenant_lookup",
      arguments: { identifier: "cust-10042" },
      result: { status: "verification_required", customerId: "CUST-10042" },
    }]);
    expect(state.authStage).toBe("awaiting_verification");
  });

  it("suppresses an identical replay when Vapi does not include a tool call ID", () => {
    let state = reduceVapiSession(initialVapiSessionState, {
      type: "tool-call",
      name: "normalize_identifier",
      arguments: { rawIdentifier: "cust-10042" },
    });
    state = reduceVapiSession(state, {
      type: "tool-call",
      name: "normalize_identifier",
      arguments: { rawIdentifier: "cust-10042" },
    });

    expect(state.toolEvents).toHaveLength(1);
  });
});
