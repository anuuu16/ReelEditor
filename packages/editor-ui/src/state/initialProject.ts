import type { ProjectModel } from "@reel-studio/shared-types";

export const VIDEO_TRACK_ID = "video-track";
export const AUDIO_TRACK_ID = "audio-track";

export function createInitialProject(): ProjectModel {
  return {
    id: "local-project",
    canvas: { aspectRatio: "9:16", width: 1080, height: 1920, frameRate: 30 },
    tracks: [
      { id: VIDEO_TRACK_ID, kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 },
      { id: AUDIO_TRACK_ID, kind: "audio", order: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
    ],
    clips: [],
    overlays: [],
    sources: [],
    metadata: { name: "Untitled reel", templateId: null, createdAt: Date.now(), updatedAt: Date.now() },
  };
}
