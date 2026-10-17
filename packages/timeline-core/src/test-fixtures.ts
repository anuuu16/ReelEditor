import type { Clip, MediaSource, ProjectModel } from "@reel-studio/shared-types";
import { NEUTRAL_FILTER } from "./filter-presets.js";

// Builders for tests: a valid clip / source / project with neutral settings, overridable per test.

export function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    sourceId: "src-1",
    trackId: "video-1",
    label: "Clip",
    inPoint: 0,
    outPoint: 4,
    timelineStart: 0,
    fitMode: "fit",
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    volume: 1,
    muted: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    speed: 1,
    opacity: 1,
    filter: { ...NEUTRAL_FILTER },
    transitionOutSeconds: 0,
    transitionOutType: "dissolve",
    gapBeforeSeconds: 0,
    ...overrides,
  };
}

export function makeSource(overrides: Partial<MediaSource> = {}): MediaSource {
  return {
    id: "src-1",
    name: "clip.mp4",
    filePath: "/media/clip.mp4",
    previewUrl: "blob:clip",
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    kind: "video",
    isPlaceholder: false,
    ...overrides,
  };
}

export function makeProject(overrides: Partial<ProjectModel> = {}): ProjectModel {
  return {
    id: "project-1",
    canvas: { aspectRatio: "9:16", width: 1080, height: 1920, frameRate: 30 },
    tracks: [{ id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }],
    clips: [makeClip()],
    overlays: [],
    sources: [makeSource()],
    metadata: {
      name: "Test project",
      templateId: null,
      isTemplate: false,
      createdAt: 0,
      updatedAt: 0,
      thumbnailDataUrl: null,
    },
    ...overrides,
  };
}
