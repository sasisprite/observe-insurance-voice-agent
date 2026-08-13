import { describe, expect, it } from "vitest";
import { formatVapiError, getVapiAssistantConfigHint, isPreConnectVapiFailure } from "./vapiDiagnostics";

describe("Vapi diagnostics", () => {
  it("turns nested Vapi errors into a readable message", () => {
    expect(formatVapiError({ error: { message: "Meeting has ended" } })).toContain("ended the session before it connected");
  });

  it("explains provider-minute exhaustion without blaming phone normalization", () => {
    const message = formatVapiError({ error: { code: "daily-error", message: "Meeting has ended", domainProps: { exceeded_total_minutes: true } } });
    expect(message).toContain("minute quota is exhausted");
    expect(message).toContain("no transcript to normalize");
    expect(message).toContain("not a lookup failure");
  });

  it("states that provider quota is metered separately from the Vapi credit balance", () => {
    // Reported symptom: the account still had credits, which made the limit look like an app bug.
    const message = formatVapiError({ error: { code: "daily-error", domainProps: { exceeded_total_minutes: true } } });
    expect(message).toContain("separately from your Vapi credit balance");
  });

  it("recognises the documented voice-provider quota ended reasons", () => {
    for (const reason of ["11labs-quota-exceeded", "cartesia-out-of-credits"]) {
      expect(formatVapiError({ endedReason: reason })).toContain("minute quota is exhausted");
    }
  });

  it("distinguishes an empty Vapi wallet from a provider quota", () => {
    const message = formatVapiError({ endedReason: "call.start.error-subscription-insufficient-credits" });
    expect(message).toContain("credit balance is too low");
    expect(message).not.toContain("metered separately");
  });

  it("distinguishes a concurrency cap from a quota", () => {
    const message = formatVapiError({ endedReason: "call.start.error-subscription-concurrency-limit-reached" });
    expect(message).toContain("simultaneous-call limit");
  });

  it("does not classify an active call as a pre-connect failure", () => {
    expect(isPreConnectVapiFailure("active")).toBe(false);
    expect(isPreConnectVapiFailure("connecting")).toBe(true);
  });

  it("explains whether an assistant id is configured", () => {
    expect(getVapiAssistantConfigHint(false)).toContain("No Vapi assistant ID");
    expect(getVapiAssistantConfigHint(true)).toContain("configured assistant");
  });
});
