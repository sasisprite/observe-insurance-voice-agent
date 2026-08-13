// @vitest-environment jsdom
import React, { useRef, useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTranscriptAutoScroll } from "./useTranscriptAutoScroll";

function TranscriptProbe() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [transcriptVersion, setTranscriptVersion] = useState(0);
  useTranscriptAutoScroll(panelRef, transcriptVersion);

  return (
    <>
      <div ref={panelRef} data-testid="transcript-panel" />
      <button type="button" onClick={() => setTranscriptVersion((value) => value + 1)}>
        add turn
      </button>
    </>
  );
}

describe("useTranscriptAutoScroll integration", () => {
  it("scrolls the mounted transcript panel after a transcript update", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    const view = render(<TranscriptProbe />);
    const panel = view.getByTestId("transcript-panel");
    Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 384 });
    scrollTo.mockClear();

    fireEvent.click(view.getByRole("button", { name: "add turn" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 384, behavior: "smooth" });
  });
});

