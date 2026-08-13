import React, { useRef } from "react";
import { transcriptPanelClassName } from "@/lib/transcriptPanel";
import { useTranscriptAutoScroll } from "@/lib/useTranscriptAutoScroll";
import { formatSpokenText } from "@/lib/spokenText";

export type TranscriptLine = { role: "user" | "assistant"; text: string };

type TranscriptPanelProps = {
  transcript: TranscriptLine[];
  /**
   * The in-flight recognizer result for the current turn. Rendering it is what makes
   * the panel feel live: without it nothing appears until endpointing finalizes the
   * sentence, which reads as a full-sentence delay.
   */
  pending?: TranscriptLine | null;
};

const bubbleClassName = (role: TranscriptLine["role"]) =>
  role === "user"
    ? "rounded-tr-sm bg-[#eeeaf7] text-[#625b79]"
    : "rounded-tl-sm bg-[#edf5ef] text-[#5b7468]";

function TranscriptBubble({ line, isPending }: { line: TranscriptLine; isPending?: boolean }) {
  return (
    <div className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 transition-opacity ${bubbleClassName(line.role)} ${isPending ? "opacity-70" : ""}`}
        aria-live={isPending ? "polite" : undefined}
        data-pending={isPending ? "true" : undefined}
      >
        <div className="mb-1 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] opacity-60">
          <span>{line.role === "user" ? "You" : "Sarah"}</span>
          {isPending && (
            <span className="flex gap-0.5" aria-hidden="true">
              <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
            </span>
          )}
        </div>
        <span className="whitespace-pre-wrap">{formatSpokenText(line.text)}</span>
      </div>
    </div>
  );
}

export function TranscriptPanel({ transcript, pending = null }: TranscriptPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Scroll on partials too, so a long in-flight turn stays in view as it grows.
  useTranscriptAutoScroll(panelRef, transcript.length + (pending?.text.length ?? 0));

  // A partial that is only whitespace must not count as content, or it suppresses the
  // empty state while rendering no bubble of its own and the panel goes blank.
  const hasPending = Boolean(pending && pending.text.trim());
  const isEmpty = transcript.length === 0 && !hasPending;

  return (
    <div ref={panelRef} className={`mt-7 ${transcriptPanelClassName}`}>
      {isEmpty ? (
        <div className="rounded-2xl border border-dashed border-[#d7d0df] px-5 py-6 text-center text-sm leading-6 text-[#918a9e]">
          Your conversation will appear here in order, one turn at a time.
        </div>
      ) : (
        <>
          {transcript.map((line, index) => (
            <TranscriptBubble key={`${line.role}-${index}`} line={line} />
          ))}
          {hasPending && pending && <TranscriptBubble line={pending} isPending />}
        </>
      )}
    </div>
  );
}

export default TranscriptPanel;
