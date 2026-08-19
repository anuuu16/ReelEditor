import type { MediaSource } from "@reel-studio/shared-types";

// The video track also accepts images as clips (a still shown for a chosen duration, e.g. to fill a
// gap between two videos) — everything else is a strict kind match.
export function trackKindAccepts(trackKind: "video" | "audio", sourceKind: MediaSource["kind"]): boolean {
  return trackKind === "video" ? sourceKind === "video" || sourceKind === "image" : sourceKind === "audio";
}

export const DEFAULT_IMAGE_CLIP_DURATION_SECONDS = 5;
export const MAX_IMAGE_CLIP_DURATION_SECONDS = 300;
