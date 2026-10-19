import { describe, expect, it } from "vitest";
import {
  buildDuckCurve,
  buildVoiceActivity,
  sampleDuckGain,
  sampleDuckGainCurve,
  smoothDuckReductionDb,
  type VoiceActivity,
} from "./duck.js";
import { dbToGain } from "./dbUtils.js";
import { makeClipFixture, makeConstantBuffer } from "./test-fixtures.js";
import { DEFAULT_DUCKING, type AudioTimeline } from "./timeline.js";

describe("smoothDuckReductionDb", () => {
  it("stays at 0 when never active", () => {
    const out = smoothDuckReductionDb(new Uint8Array(10), 0.05, 12, 0.1, 0.3);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it("ramps up toward amountDb on attack and back to 0 on release", () => {
    const active = new Uint8Array(40).fill(0);
    active.set(new Uint8Array(20).fill(1), 5); // quiet, then speaking frames 5..24, quiet after
    const out = smoothDuckReductionDb(active, 0.05, 12, 0.1, 0.3);
    // Before speech starts: no reduction yet.
    expect(out[4]).toBe(0);
    // Reduction grows monotonically while active...
    expect(out[6]).toBeGreaterThan(out[5]);
    expect(out[10]).toBeGreaterThan(out[6]);
    // ...and approaches (but given finite attack time, doesn't necessarily reach) amountDb.
    expect(out[24]).toBeGreaterThan(8);
    expect(out[24]).toBeLessThanOrEqual(12.01);
    // After speech ends it eases back down rather than snapping instantly.
    expect(out[25]).toBeLessThan(out[24]);
    expect(out[25]).toBeGreaterThan(0);
  });

  it("a longer attack ramps more slowly than a shorter one", () => {
    const active = new Uint8Array(20).fill(1);
    const fast = smoothDuckReductionDb(active, 0.05, 12, 0.05, 0.3);
    const slow = smoothDuckReductionDb(active, 0.05, 12, 0.5, 0.3);
    expect(fast[2]).toBeGreaterThan(slow[2]);
  });
});

describe("buildDuckCurve", () => {
  const activity: VoiceActivity = {
    frameSec: 0.1,
    totalSec: 1,
    levelDb: new Float32Array([-90, -90, -10, -10, -10, -90, -90, -90, -90, -90]),
  };

  it("marks frames above the threshold as active", () => {
    const curve = buildDuckCurve(activity, { ...DEFAULT_DUCKING, thresholdDb: -34, attackSec: 0, releaseSec: 0, holdSec: 0 });
    expect(Array.from(curve.active)).toEqual([0, 0, 1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it("fully-ducks (instant attack/release) to the configured amount while active", () => {
    const curve = buildDuckCurve(activity, { ...DEFAULT_DUCKING, amountDb: 12, thresholdDb: -34, attackSec: 0, releaseSec: 0, holdSec: 0 });
    expect(curve.gain[2]).toBeCloseTo(dbToGain(-12), 4);
    expect(curve.gain[0]).toBeCloseTo(1, 4);
  });
});

describe("sampleDuckGain / sampleDuckGainCurve", () => {
  const curve = { frameSec: 1, gain: new Float32Array([1, 0.5, 0.5, 1]) };

  it("reads exact frame samples", () => {
    expect(sampleDuckGain(curve, 0)).toBeCloseTo(1, 5);
    expect(sampleDuckGain(curve, 1)).toBeCloseTo(0.5, 5);
  });

  it("interpolates between frames", () => {
    expect(sampleDuckGain(curve, 0.5)).toBeCloseTo(0.75, 5);
  });

  it("clamps past the end of the curve", () => {
    expect(sampleDuckGain(curve, 100)).toBeCloseTo(1, 5);
  });

  it("produces a fixed-length array spanning the requested range", () => {
    const out = sampleDuckGainCurve(curve, 0, 2, 5);
    expect(out.length).toBe(5);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[out.length - 1]).toBeCloseTo(0.5, 5);
  });
});

describe("buildVoiceActivity", () => {
  function makeTimeline(clips: ReturnType<typeof makeClipFixture>[]): AudioTimeline {
    return {
      sources: [{ id: "src-1", name: "voice", buffer: makeConstantBuffer(0.5, 1) }],
      clips,
      notes: [],
      laneCount: 1,
      ducking: DEFAULT_DUCKING,
    };
  }

  it("is silent (floor) when there are no voice clips", () => {
    const timeline = makeTimeline([makeClipFixture({ role: "music", trimEndSec: 1 })]);
    const activity = buildVoiceActivity(timeline, () => 1);
    expect(Array.from(activity.levelDb).every((v) => v <= -89)).toBe(true);
  });

  it("reads a constant-level voice clip's level back out", () => {
    const timeline = makeTimeline([makeClipFixture({ role: "voice", trimEndSec: 1 })]);
    const activity = buildVoiceActivity(timeline, () => 1, 0.1);
    // 0.5 amplitude constant tone -> ~-6dB, across every frame covered by the clip.
    const mid = activity.levelDb[Math.floor(activity.levelDb.length / 2)];
    expect(mid).toBeCloseTo(20 * Math.log10(0.5), 0);
  });

  it("ignores a muted voice clip", () => {
    const timeline = makeTimeline([makeClipFixture({ role: "voice", trimEndSec: 1, muted: true })]);
    const activity = buildVoiceActivity(timeline, () => 1);
    expect(Array.from(activity.levelDb).every((v) => v <= -89)).toBe(true);
  });
});
