// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { integratedLoudnessFromBlocks, loudnessRangeFromShortTerm, measureLoudnessChannels, truePeakOf } from "./ebur128.js";
import { readPcm16Wav } from "./test-fixtures.js";

// Reference values are ffmpeg's (`ffmpeg -i <file> -af ebur128=peak=true -f null -`), as recorded
// in samples/README.md — the whole point of this module is to agree with that.
function loadSample(name: string) {
  const bytes = readFileSync(new URL(`../../../../samples/${name}`, import.meta.url));
  return readPcm16Wav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function sine(freq: number, amplitude: number, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

describe("measureLoudnessChannels against ffmpeg ebur128", () => {
  it("voice-like-20s.wav: -21.9 LUFS, -17.0 dBTP", () => {
    const { sampleRate, channels } = loadSample("voice-like-20s.wav");
    const m = measureLoudnessChannels(channels, sampleRate);
    expect(m.integratedLufs).toBeCloseTo(-21.9, 0);
    expect(Math.abs(m.integratedLufs - -21.9)).toBeLessThan(0.15);
    expect(Math.abs(m.truePeakDbtp - -17.0)).toBeLessThan(0.15);
    expect(m.loudnessRangeLu).toBeLessThan(1);
  });

  it("quiet-tone-8s.wav: -33.8 LUFS, -30.1 dBTP", () => {
    const { sampleRate, channels } = loadSample("quiet-tone-8s.wav");
    const m = measureLoudnessChannels(channels, sampleRate);
    expect(Math.abs(m.integratedLufs - -33.8)).toBeLessThan(0.15);
    expect(Math.abs(m.truePeakDbtp - -30.1)).toBeLessThan(0.15);
  });

  it("music-dynamic-16s.wav (stereo, 48 kHz, quiet→loud with a silent gap): -9.9 LUFS, 14.5 LU, -3.0 dBTP", () => {
    const { sampleRate, channels } = loadSample("music-dynamic-16s.wav");
    expect(channels.length).toBe(2);
    const m = measureLoudnessChannels(channels, sampleRate);
    // The integrated figure only lands on -9.9 if both gates work: the silent gap is dropped by
    // the absolute gate and the quiet intro by the relative gate.
    expect(Math.abs(m.integratedLufs - -9.9)).toBeLessThan(0.15);
    expect(Math.abs(m.truePeakDbtp - -3.0)).toBeLessThan(0.15);
    // LRA percentiles are histogram-binned in ffmpeg, so allow a little more slack there.
    expect(Math.abs(m.loudnessRangeLu - 14.5)).toBeLessThan(0.5);
  });

  it("a 1 kHz full-scale sine reads -3.01 LUFS mono / 0 dBTP (BS.1770's own reference point)", () => {
    const sr = 48000;
    const m = measureLoudnessChannels([sine(1000, 1, 5, sr)], sr);
    // Per BS.1770, a 0 dBFS 1 kHz sine in one channel = -3.01 LUFS.
    expect(Math.abs(m.integratedLufs - -3.01)).toBeLessThan(0.1);
    expect(Math.abs(m.truePeakDbtp)).toBeLessThan(0.05);
    expect(m.loudnessRangeLu).toBeLessThan(0.1);
  });

  it("stereo doubles the energy: same sine in both channels is +3 LU", () => {
    const sr = 44100;
    const s = sine(1000, 0.5, 4, sr);
    const mono = measureLoudnessChannels([s], sr).integratedLufs;
    const stereo = measureLoudnessChannels([s, s], sr).integratedLufs;
    expect(stereo - mono).toBeCloseTo(3.01, 1);
  });

  it("digital silence reports -Infinity / 0 LRA rather than NaN", () => {
    const m = measureLoudnessChannels([new Float32Array(48000)], 48000);
    expect(m.integratedLufs).toBe(-Infinity);
    expect(m.truePeakDbtp).toBe(-Infinity);
    expect(m.loudnessRangeLu).toBe(0);
  });
});

describe("true peak", () => {
  it("finds inter-sample peaks a plain sample peak misses", () => {
    // A high-frequency sine sampled so its samples never land on the crest: sample peak is
    // well under 1.0, the true (reconstructed) peak is ~1.0.
    const sr = 48000;
    const freq = sr / 4 + 0; // 12 kHz: 4 samples per cycle, phase-shifted so crests fall between samples
    const out = new Float32Array(sr);
    for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sr + Math.PI / 4);
    const samplePeak = Math.max(...Array.from(out.subarray(0, 1000)).map(Math.abs));
    expect(samplePeak).toBeCloseTo(Math.SQRT1_2, 3);
    expect(truePeakOf(out, sr)).toBeGreaterThan(0.97);
  });
});

describe("gating helpers", () => {
  it("relative gate drops quiet blocks instead of averaging them in", () => {
    // Ten blocks at -20 LUFS plus ten at -40 LUFS: the -40 ones are more than 10 LU under the
    // absolute-gated mean and must be excluded, so the result is the loud blocks' own level.
    const loud = Math.pow(10, (-20 + 0.691) / 10);
    const quiet = Math.pow(10, (-40 + 0.691) / 10);
    const blocks = [...Array(10).fill(loud), ...Array(10).fill(quiet)];
    expect(integratedLoudnessFromBlocks(blocks)).toBeCloseTo(-20, 1);
  });

  it("LRA is the 10th-95th percentile spread of short-term loudness", () => {
    const values = Array.from({ length: 100 }, (_, i) => -30 + i * 0.1); // -30 … -20.1
    const lra = loudnessRangeFromShortTerm(values);
    expect(lra).toBeGreaterThan(7);
    expect(lra).toBeLessThan(9);
  });
});
