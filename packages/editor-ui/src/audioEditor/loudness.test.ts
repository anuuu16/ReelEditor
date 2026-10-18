import { describe, expect, it } from "vitest";
import { computeIntegratedLoudnessDb, computeLoudnessOverMask, computePeakDb } from "./loudness.js";
import { makeConstantBuffer, makeSegmentedBuffer } from "./test-fixtures.js";

describe("computePeakDb", () => {
  it("reads a constant-amplitude buffer's peak", () => {
    const buf = makeConstantBuffer(0.5, 0.5);
    expect(computePeakDb(buf)).toBeCloseTo(20 * Math.log10(0.5), 3);
  });
});

describe("computeIntegratedLoudnessDb", () => {
  it("a louder constant tone reads louder than a quieter one", () => {
    const quiet = computeIntegratedLoudnessDb(makeConstantBuffer(0.1, 2));
    const loud = computeIntegratedLoudnessDb(makeConstantBuffer(0.5, 2));
    expect(loud).toBeGreaterThan(quiet);
  });

  it("a constant tone's loudness matches its own level (no dynamics to gate)", () => {
    const db = computeIntegratedLoudnessDb(makeConstantBuffer(0.5, 2));
    expect(db).toBeCloseTo(20 * Math.log10(0.5), 1);
  });

  it("gates out long silence instead of averaging it in", () => {
    // One loud second, then ten seconds of silence: ungated RMS would read ~-21dB; gating the
    // silent blocks out should instead report close to the loud segment's own level.
    const buf = makeSegmentedBuffer([
      [0.5, 1],
      [0, 10],
    ]);
    const db = computeIntegratedLoudnessDb(buf);
    expect(db).toBeGreaterThan(-10);
  });

  it("floors at the given floorDb for true silence", () => {
    const buf = makeConstantBuffer(0, 1);
    expect(computeIntegratedLoudnessDb(buf, 0, buf.duration, -90)).toBe(-90);
  });
});

describe("computeLoudnessOverMask", () => {
  it("only measures frames flagged active in the mask", () => {
    // 4 frames of 0.5s: loud, quiet, loud, quiet. Masking just the quiet frames should read near
    // the floor; masking just the loud frames should read near the loud level.
    const frameSec = 0.5;
    const buf = makeSegmentedBuffer([
      [0.5, frameSec],
      [0.01, frameSec],
      [0.5, frameSec],
      [0.01, frameSec],
    ]);
    const loudMask = new Uint8Array([1, 0, 1, 0]);
    const quietMask = new Uint8Array([0, 1, 0, 1]);
    const loudDb = computeLoudnessOverMask(buf, frameSec, loudMask);
    const quietDb = computeLoudnessOverMask(buf, frameSec, quietMask);
    expect(loudDb).toBeGreaterThan(quietDb + 10);
  });

  it("returns the floor when nothing in the mask is set", () => {
    const buf = makeConstantBuffer(0.5, 1);
    expect(computeLoudnessOverMask(buf, 0.5, new Uint8Array([0, 0]), -90)).toBe(-90);
  });
});
