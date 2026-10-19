import { describe, expect, it } from "vitest";
import type { Clip } from "@reel-studio/shared-types";
import { findActiveClip, findTransitionAt, getOverlapSeconds, getSequenceDuration, layoutSequentialClips } from "./sequential-layout.js";
import { snapTime } from "./snapping.js";
import { getTimelineDuration } from "./track-utils.js";
import { makeClip, makeProject, makeTitle } from "./test-fixtures.js";

describe("layoutSequentialClips", () => {
  it("places clips one after another", () => {
    const laidOut = layoutSequentialClips([makeClip({ id: "a" }), makeClip({ id: "b" })]);
    expect(laidOut.map((c) => [c.timelineStart, c.duration])).toEqual([
      [0, 4],
      [4, 4],
    ]);
    expect(getSequenceDuration(laidOut)).toBe(8);
  });

  it("divides a clip's length by its speed", () => {
    const [clip] = layoutSequentialClips([makeClip({ speed: 2 })]);
    expect(clip.duration).toBe(2);
  });

  it("starts the next clip early by the transition length", () => {
    const [a, b] = layoutSequentialClips([makeClip({ id: "a", transitionOutSeconds: 1 }), makeClip({ id: "b" })]);
    expect(b.timelineStart).toBe(3);
    expect(getOverlapSeconds(a, b)).toBe(1);
  });

  it("caps a transition at half of either clip", () => {
    const [, b] = layoutSequentialClips([makeClip({ id: "a", transitionOutSeconds: 10 }), makeClip({ id: "b" })]);
    expect(b.timelineStart).toBe(2);
  });

  it("adds the gap before a clip", () => {
    const [, b] = layoutSequentialClips([makeClip({ id: "a" }), makeClip({ id: "b", gapBeforeSeconds: 1.5 })]);
    expect(b.timelineStart).toBe(5.5);
  });

  it("reads projects saved before transitions and gaps existed", () => {
    const old = (id: string) => {
      const clip: Partial<Clip> = makeClip({ id });
      delete clip.transitionOutSeconds;
      delete clip.gapBeforeSeconds;
      return clip as Clip;
    };
    const laidOut = layoutSequentialClips([old("a"), old("b")]);
    expect(laidOut.map((c) => c.timelineStart)).toEqual([0, 4]);
  });

  it("returns an empty sequence for no clips", () => {
    expect(getSequenceDuration(layoutSequentialClips([]))).toBe(0);
  });
});

describe("findActiveClip", () => {
  const laidOut = layoutSequentialClips([makeClip({ id: "a", inPoint: 1, outPoint: 5, speed: 2 }), makeClip({ id: "b" })]);

  it("maps timeline time to source time", () => {
    expect(findActiveClip(laidOut, 1)).toMatchObject({ index: 0, localTime: 3 });
  });

  it("moves to the next clip at the boundary", () => {
    expect(findActiveClip(laidOut, 2)?.clip.id).toBe("b");
  });

  it("returns null after the last clip", () => {
    expect(findActiveClip(laidOut, 6)).toBeNull();
  });
});

describe("findTransitionAt", () => {
  const laidOut = layoutSequentialClips([makeClip({ id: "a", transitionOutSeconds: 1 }), makeClip({ id: "b" })]);

  it("reports progress through the overlap", () => {
    const transition = findTransitionAt(laidOut, 3.5);
    expect(transition?.outgoing.clip.id).toBe("a");
    expect(transition?.incoming.clip.id).toBe("b");
    expect(transition?.progress).toBeCloseTo(0.5);
  });

  it("returns null outside the overlap", () => {
    expect(findTransitionAt(laidOut, 2)).toBeNull();
  });
});

describe("snapTime", () => {
  it("snaps to a target within the threshold", () => {
    expect(snapTime(1.05, [1, 2], 0.1)).toBe(1);
  });

  it("keeps the time when no target is close enough", () => {
    expect(snapTime(1.5, [1, 2], 0.1)).toBe(1.5);
  });

  it("keeps the first target on a tie", () => {
    expect(snapTime(1.5, [1, 2], 0.6)).toBe(1);
  });
});

describe("getTimelineDuration", () => {
  const tracks = [
    { id: "video-1", kind: "video" as const, order: 0, volume: 1, fadeIn: 0, fadeOut: 0 },
    { id: "audio-1", kind: "audio" as const, order: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
  ];

  it("is the video track's length on its own", () => {
    expect(getTimelineDuration(makeProject())).toBe(4);
  });

  it("is the longest of the video track, each audio track and the titles", () => {
    const music = makeClip({ id: "music", trackId: "audio-1", outPoint: 9 });
    expect(getTimelineDuration(makeProject({ tracks, clips: [makeClip(), music] }))).toBe(9);
    expect(getTimelineDuration(makeProject({ tracks, clips: [makeClip(), music], overlays: [makeTitle({ end: 12 })] }))).toBe(12);
  });

  it("is 0 for an empty project", () => {
    expect(getTimelineDuration(makeProject({ clips: [] }))).toBe(0);
  });

  it("'black' and 'freeze' don't change the length, only what's drawn during it", () => {
    const music = makeClip({ id: "music", trackId: "audio-1", outPoint: 9 });
    const project = makeProject({ tracks, clips: [makeClip(), music], endBehavior: "black" });
    expect(getTimelineDuration(project)).toBe(9);
    expect(getTimelineDuration({ ...project, endBehavior: "freeze" })).toBe(9);
  });

  it("'trim' cuts the reel down to the video track's own length", () => {
    const music = makeClip({ id: "music", trackId: "audio-1", outPoint: 9 });
    const project = makeProject({ tracks, clips: [makeClip(), music], endBehavior: "trim" });
    expect(getTimelineDuration(project)).toBe(4); // makeClip()'s default 4 s clip, not the 9 s of music
  });

  it("'trim' with no video clips at all is a 0 s reel, however long the audio/titles run", () => {
    const project = makeProject({ tracks, clips: [makeClip({ trackId: "audio-1", outPoint: 9 })], endBehavior: "trim" });
    expect(getTimelineDuration(project)).toBe(0);
  });
});
