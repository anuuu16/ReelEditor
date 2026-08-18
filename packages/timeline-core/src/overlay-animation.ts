import type { Overlay } from "@reel-studio/shared-types";

export const FADE_DURATION_SECONDS = 0.4;

export function computeOverlayAlpha(overlay: Pick<Overlay, "start" | "end" | "animation">, time: number): number {
  if (overlay.animation !== "fade") return 1;

  const duration = overlay.end - overlay.start;
  const fadeDuration = Math.min(FADE_DURATION_SECONDS, duration / 2);
  if (fadeDuration <= 0) return 1;

  const positionInOverlay = time - overlay.start;
  const timeFromEnd = overlay.end - time;

  let alpha = 1;
  if (positionInOverlay < fadeDuration) alpha = Math.min(alpha, positionInOverlay / fadeDuration);
  if (timeFromEnd < fadeDuration) alpha = Math.min(alpha, timeFromEnd / fadeDuration);
  return Math.max(0, Math.min(1, alpha));
}

export function isOverlayActive(overlay: Pick<Overlay, "start" | "end">, time: number): boolean {
  return time >= overlay.start && time < overlay.end;
}
