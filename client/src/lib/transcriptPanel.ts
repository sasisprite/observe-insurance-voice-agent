export const transcriptPanelClassName = "max-h-64 min-h-[6rem] space-y-3 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:#c4bdd0_transparent] [scrollbar-width:thin]";

export const transcriptPanelStyleContract = {
  maxHeight: "16rem",
  overflowY: "auto",
} as const;

export function hasInternalTranscriptScroll(className: string): boolean {
  return className.includes("max-h-64") && className.includes("overflow-y-auto");
}

export function getTranscriptScrollTarget(scrollHeight: number): { top: number; behavior: "smooth" } {
  return { top: Math.max(0, scrollHeight), behavior: "smooth" };
}

export type TranscriptScrollableElement = {
  scrollHeight: number;
  scrollTo: (options: { top: number; behavior: "smooth" }) => void;
};

export function scrollTranscriptToLatest(panel: TranscriptScrollableElement | null): void {
  if (!panel) return;
  panel.scrollTo(getTranscriptScrollTarget(panel.scrollHeight));
}
