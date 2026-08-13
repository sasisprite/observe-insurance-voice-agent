// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TranscriptPanel, type TranscriptLine } from "./TranscriptPanel";

function stubScrollTo() {
  const scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  return scrollTo;
}

describe("TranscriptPanel integration", () => {
  it("scrolls the real Home transcript panel when a new turn is rendered", () => {
    const scrollTo = stubScrollTo();
    const firstTurn: TranscriptLine[] = [{ role: "assistant", text: "How can I help?" }];
    const nextTurn: TranscriptLine[] = [...firstTurn, { role: "user", text: "I need a claim update." }];
    const view = render(<TranscriptPanel transcript={firstTurn} />);
    const panel = view.container.querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 768 });
    scrollTo.mockClear();

    view.rerender(<TranscriptPanel transcript={nextTurn} />);

    expect(panel.textContent).toContain("I need a claim update.");
    expect(scrollTo).toHaveBeenCalledWith({ top: 768, behavior: "smooth" });
  });

  it("renders the in-flight partial so text appears before the sentence finalizes", () => {
    stubScrollTo();
    const view = render(
      <TranscriptPanel transcript={[]} pending={{ role: "user", text: "my claim number is" }} />,
    );

    const pending = view.container.querySelector('[data-pending="true"]');
    expect(pending).not.toBeNull();
    expect(pending?.textContent).toContain("my claim number is");
    expect(view.container.textContent).not.toContain("Your conversation will appear here");
  });

  it("grows the pending bubble as more of the turn arrives, without adding a new bubble", () => {
    stubScrollTo();
    const view = render(<TranscriptPanel transcript={[]} pending={{ role: "user", text: "my claim" }} />);

    view.rerender(<TranscriptPanel transcript={[]} pending={{ role: "user", text: "my claim number is" }} />);

    expect(view.container.querySelectorAll('[data-pending="true"]')).toHaveLength(1);
    expect(view.container.textContent).toContain("my claim number is");
  });

  it("cleans spoken digit runs in both finalized and pending text", () => {
    stubScrollTo();
    const view = render(
      <TranscriptPanel
        transcript={[{ role: "user", text: "plus one triple five two three four five six seven eight" }]}
        pending={{ role: "user", text: "and my code is one two three four" }}
      />,
    );

    expect(view.container.textContent).toContain("+1 (555) 234-5678");
    expect(view.container.textContent).toContain("and my code is 1234");
    expect(view.container.textContent).not.toContain("triple five");
  });

  it("drops a pending bubble once the turn finalizes into the transcript", () => {
    stubScrollTo();
    const view = render(<TranscriptPanel transcript={[]} pending={{ role: "user", text: "I need help" }} />);

    view.rerender(<TranscriptPanel transcript={[{ role: "user", text: "I need help." }]} pending={null} />);

    expect(view.container.querySelector('[data-pending="true"]')).toBeNull();
    expect(view.container.textContent).toContain("I need help.");
  });

  it("ignores a whitespace-only partial", () => {
    stubScrollTo();
    const view = render(<TranscriptPanel transcript={[]} pending={{ role: "user", text: "   " }} />);

    expect(view.container.querySelector('[data-pending="true"]')).toBeNull();
    expect(view.container.textContent).toContain("Your conversation will appear here");
  });
});
