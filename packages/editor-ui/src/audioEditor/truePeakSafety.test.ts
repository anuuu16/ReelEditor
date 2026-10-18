import { describe, expect, it } from "vitest";
import { truePeakOf } from "./ebur128.js";
import { applyTrimToChannels, measureTruePeakDbtp, truePeakSafetyTrimDb } from "./truePeakSafety.js";

function sine(freq: number, amp: number, sec: number, sr: number): Float32Array {
  const out = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe("truePeakSafetyTrimDb", () => {
  it("is 0 for a mix already under the ceiling — never boosts", () => {
    expect(truePeakSafetyTrimDb(-6)).toBe(0);
    expect(truePeakSafetyTrimDb(-1.0)).toBe(0);
    expect(truePeakSafetyTrimDb(-Infinity)).toBe(0);
  });

  it("trims by exactly the overshoot past the ceiling", () => {
    expect(truePeakSafetyTrimDb(-0.5)).toBeCloseTo(0.5, 6);
    expect(truePeakSafetyTrimDb(5.5)).toBeCloseTo(6.5, 6);
  });
});

describe("applyTrimToChannels + measureTruePeakDbtp", () => {
  it("a hot summed mix lands on the ceiling after the trim, with no sample at/over full scale", () => {
    const sr = 48000;
    // Two clips summed like mixdown does: combined sample peak ~1.6 (+4 dBFS), like the hot-mix
    // experiment where the 16-bit WAV writer would hard-clip and lossy codecs would overshoot.
    const mix = sine(220, 0.8, 1, sr);
    const other = sine(330, 0.8, 1, sr);
    for (let i = 0; i < mix.length; i++) mix[i] += other[i];
    const before = measureTruePeakDbtp([mix], sr);
    expect(before).toBeGreaterThan(0);

    const trimDb = truePeakSafetyTrimDb(before);
    const [trimmed] = applyTrimToChannels([mix], trimDb);
    const after = measureTruePeakDbtp([trimmed], sr);
    expect(after).toBeCloseTo(-1, 1);
    expect(Math.max(...Array.from(trimmed).map(Math.abs))).toBeLessThan(1);
  });

  it("catches inter-sample overshoot a plain sample clamp would miss", () => {
    const sr = 48000;
    // Crests between samples: sample peak ≈ 0.707·a but true peak ≈ a.
    const n = sr;
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = 0.99 * Math.sin((2 * Math.PI * (sr / 4) * i) / sr + Math.PI / 4);
    const samplePeak = Math.max(...Array.from(ch.subarray(0, 1000)).map(Math.abs));
    expect(samplePeak).toBeLessThan(0.71); // looks "safe" to a sample-peak check…
    const tp = measureTruePeakDbtp([ch], sr);
    expect(tp).toBeGreaterThan(-0.3); // …but actually has no headroom
    const [trimmed] = applyTrimToChannels([ch], truePeakSafetyTrimDb(tp));
    expect(20 * Math.log10(truePeakOf(trimmed, sr))).toBeLessThanOrEqual(-0.9);
  });

  it("returns the same arrays untouched when no trim is needed", () => {
    const ch = sine(440, 0.1, 0.5, 44100);
    const out = applyTrimToChannels([ch], 0);
    expect(out[0]).toBe(ch);
  });
});
