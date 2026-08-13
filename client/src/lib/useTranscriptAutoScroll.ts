import { useEffect, type RefObject } from "react";
import { scrollTranscriptToLatest, type TranscriptScrollableElement } from "./transcriptPanel";

export function useTranscriptAutoScroll(
  panelRef: RefObject<TranscriptScrollableElement | null>,
  transcriptVersion: number,
): void {
  useEffect(() => {
    scrollTranscriptToLatest(panelRef.current);
  }, [panelRef, transcriptVersion]);
}

export default useTranscriptAutoScroll;

