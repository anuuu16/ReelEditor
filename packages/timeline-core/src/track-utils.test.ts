import { describe, expect, it } from "vitest";
import type { Overlay, Track } from "@reel-studio/shared-types";
import { makeClip, makeProject, makeSource } from "./test-fixtures.js";
import { getOverlaysEnd, getProjectDuration } from "./track-utils.js";

const videoTrack: Track = { id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 };
const audioTrack: Track = { id: "audio-1", kind: "audio", order: 1, volume: 1, fadeIn: 0, fadeOut: 0 };
const audioTrack2: Track = { id: "audio-2", kind: "audio", order: 2, volume: 1, fadeIn: 0, fadeOut: 0 };
const overlayTrack: Track = { id: "overlay-1", kind: "overlay", order: 3, volume: 1, fadeIn: 0, fadeOut: 0 };

function title(start: number, end: number): Overlay {
  return {
    id: `title-${start}-${end}`,
    trackId: "overlay-1",
    kind: "text",
    content: "Hi",
    imageSourceId: null,
    widthRatio: 1,
    heightRatio: 1,
    start,
    end,
    position: { x: 0.5, y: 0.5 },
    style: { font: "system-ui", size: 48, color: "#fff", align: "center", background: null, outline: null },
    animation: "none",
  };
}

describe("getProjectDuration", () => {
  it("is the video track's length when nothing else is longer", () => {
    expect(getProjectDuration(makeProject())).toBe(4);
  });

  it("is 0 for an empty timeline", () => {
    expect(getProjectDuration(makeProject({ clips: [] }))).toBe(0);
  });

  it("extends to the end of the longest audio track (tracks play concurrently, so they don't add up)", () => {
    const project = makeProject({
      tracks: [videoTrack, audioTrack, audioTrack2],
      sources: [makeSource(), makeSource({ id: "music", kind: "audio" })],
      clips: [
        makeClip(),
        makeClip({ id: "m1", sourceId: "music", trackId: "audio-1", outPoint: 9 }),
        makeClip({ id: "m2", sourceId: "music", trackId: "audio-2", outPoint: 6 }),
      ],
    });
    expect(getProjectDuration(project)).toBe(9);
  });

  it("extends to the end of the last title/logo", () => {
    const project = makeProject({ tracks: [videoTrack, overlayTrack], overlays: [title(0, 12), title(1, 2)] });
    expect(getOverlaysEnd(project)).toBe(12);
    expect(getProjectDuration(project)).toBe(12);
  });

  it("title + video + music: 12 s title, 4 s clip, 9 s music → 12 s", () => {
    const project = makeProject({
      tracks: [videoTrack, audioTrack, overlayTrack],
      sources: [makeSource(), makeSource({ id: "music", kind: "audio" })],
      clips: [makeClip(), makeClip({ id: "m1", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
      overlays: [title(0, 12)],
    });
    expect(getProjectDuration(project)).toBe(12);
  });

  it("has a length even with an empty video track", () => {
    const project = makeProject({
      tracks: [videoTrack, audioTrack],
      sources: [makeSource({ id: "music", kind: "audio" })],
      clips: [makeClip({ id: "m1", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
    });
    expect(getProjectDuration(project)).toBe(9);
  });
});
