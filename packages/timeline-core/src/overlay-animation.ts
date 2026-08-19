import type { Overlay } from "@reel-studio/shared-types";

// Shared entrance/exit duration for fade, slide-in, and pop — kept as one constant so all
// three animation types feel consistent and so preview/export can't drift on timing.
export const FADE_DURATION_SECONDS = 0.4;

function animationProgress(overlay: Pick<Overlay, "start" | "end">, time: number): number {
  const duration = overlay.end - overlay.start;
  const animDuration = Math.min(FADE_DURATION_SECONDS, duration);
  if (animDuration <= 0) return 1;
  return Math.max(0, Math.min(1, (time - overlay.start) / animDuration));
}

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

// The direction a slide-in enters from: whichever screen edge is nearer to the overlay's
// resting position, so it always travels the shorter, more natural distance.
export function slideStartOffsetRatio(overlay: Pick<Overlay, "position">): number {
  return overlay.position.x <= 0.5 ? -0.6 : 0.6;
}

// Horizontal offset (as a fraction of canvas width) to add to position.x while sliding in;
// settles to 0 once the animation window has elapsed.
export function computeOverlaySlideOffsetRatio(overlay: Pick<Overlay, "start" | "end" | "animation" | "position">, time: number): number {
  if (overlay.animation !== "slide-in") return 0;
  const progress = animationProgress(overlay, time);
  return slideStartOffsetRatio(overlay) * (1 - progress);
}

// Scale multiplier while popping in (grows from 50% to 100%); 1 once settled.
export function computeOverlayPopScale(overlay: Pick<Overlay, "start" | "end" | "animation">, time: number): number {
  if (overlay.animation !== "pop") return 1;
  const progress = animationProgress(overlay, time);
  return 0.5 + 0.5 * progress;
}

export function isOverlayActive(overlay: Pick<Overlay, "start" | "end">, time: number): boolean {
  return time >= overlay.start && time < overlay.end;
}
