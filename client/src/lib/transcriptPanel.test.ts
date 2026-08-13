import { describe, expect, it } from "vitest";
import { initialVapiSessionState, reduceVapiSession } from "./vapiSession";
import { getTranscriptScrollTarget, hasInternalTranscriptScroll, scrollTranscriptToLatest, transcriptPanelClassName, transcriptPanelStyleContract } from "./transcriptPanel";

describe("voice conversation presentation", () => {
  it("preserves chronological user and assistant turns in one stream", () => {
    let state = initialVapiSessionState;
    state = reduceVapiSession(state, { type: "transcript", role: "assistant", text: "How may I help?" });
    state = reduceVapiSession(state, { type: "transcript", role: "user", text: "I need a claim update." });
    state = reduceVapiSession(state, { type: "transcript", role: "assistant", text: "I can help authenticate you." });
    state = reduceVapiSession(state, { type: "transcript", role: "user", text: "Plus one, five five five." });

    expect(state.transcript).toEqual([
      { role: "assistant", text: "How may I help?" },
      { role: "user", text: "I need a claim update." },
      { role: "assistant", text: "I can help authenticate you." },
      { role: "user", text: "Plus one, five five five." },
    ]);
  });

  it("keeps the transcript panel bounded and internally scrollable", () => {
    expect(hasInternalTranscriptScroll(transcriptPanelClassName)).toBe(true);
    expect(transcriptPanelStyleContract).toEqual({ maxHeight: "16rem", overflowY: "auto" });
  });

  it("scrolls smoothly to the latest transcript content", () => {
    expect(getTranscriptScrollTarget(640)).toEqual({ top: 640, behavior: "smooth" });
    expect(getTranscriptScrollTarget(-1)).toEqual({ top: 0, behavior: "smooth" });
  });

  it("applies the scroll target to the real transcript panel bridge", () => {
    const calls: Array<{ top: number; behavior: "smooth" }> = [];
    scrollTranscriptToLatest({ scrollHeight: 512, scrollTo: (options) => calls.push(options) });
    expect(calls).toEqual([{ top: 512, behavior: "smooth" }]);
  });
});
