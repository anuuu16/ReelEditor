// End-to-end scenarios for auto-ducking, built from plain sample arrays through the same
// buildVoiceActivity → buildClipLevels → buildDuckCurve path mixdown.ts uses (only the final Web
// Audio node wiring is left out). Each case states the behaviour the editor promises.
import { describe, expect, it } from "vitest";
import { buildClipLevels, buildDuckCurve, buildVoiceActivity, type DuckCurve } from "./duck.js";
import { resolveClipBaseGain } from "./mixdown.js";
import { makeClipFixture, makeConstantBuffer, makeSegmentedBuffer } from "./test-fixtures.js";
import { DEFAULT_DUCKING, type AudioClip, type AudioSource, type AudioTimeline, type DuckingSettings } from "./timeline.js";

const baseGainOf = (clip: AudioClip, source: AudioSource) => resolveClipBaseGain(clip, source.buffer);

function timeline(sources: AudioSource[], clips: AudioClip[], ducking: Partial<DuckingSettings> = {}): AudioTimeline {
  return { sources, clips, notes: [], laneCount: 2, ducking: { ...DEFAULT_DUCKING, enabled: true, ...ducking } };
}

// The curve a given backing clip would get in mixdown(): voice activity from every voice clip,
// adaptive measurement from the backing clip itself.
function curveFor(t: AudioTimeline, backingClip: AudioClip): DuckCurve {
  const activity = buildVoiceActivity(t, baseGainOf);
  const backing = t.ducking.adaptive ? buildClipLevels(t, [backingClip], baseGainOf) : null;
  return buildDuckCurve(activity, t.ducking, backing);
}

const frameAt = (curve: DuckCurve, sec: number) => Math.min(curve.gain.length - 1, Math.round(sec / curve.frameSec));
const reductionAt = (curve: DuckCurve, sec: number) => curve.reductionDb[frameAt(curve, sec)];
const maxReduction = (curve: DuckCurve) => Math.max(...Array.from(curve.reductionDb));
const activeTransitions = (curve: DuckCurve): string[] => {
  const out: string[] = [];
  let prev = 0;
  for (let i = 0; i <= curve.active.length; i++) {
    const a = i < curve.active.length ? curve.active[i] : 0;
    if (a !== prev) {
      out.push(`${a ? "on" : "off"}@${(i * curve.frameSec).toFixed(2)}`);
      prev = a;
    }
  }
  return out;
};

const VOICE_AMP = 0.3; // ≈ -10.5 dBFS
const music = (amp: number, sec: number): AudioSource => ({ id: "m", name: "music", buffer: makeConstantBuffer(amp, sec) });
const musicClip = (overrides: Partial<AudioClip> = {}) =>
  makeClipFixture({ id: "music", sourceId: "m", role: "music", laneIndex: 1, trimEndSec: 4, ...overrides });

describe("scenario: two voice clips on two lanes overlapping each other", () => {
  // Lane 1: speech 0–2 s. Lane 2: the same source starting at 1 s, so both speak during 1–2 s.
  const v: AudioSource = {
    id: "v",
    name: "voice",
    buffer: makeSegmentedBuffer([
      [VOICE_AMP, 2],
      [0, 1],
    ]),
  };
  const clips = [
    makeClipFixture({ id: "a", sourceId: "v", role: "voice", laneIndex: 0, startSec: 0, trimEndSec: 3 }),
    makeClipFixture({ id: "b", sourceId: "v", role: "voice", laneIndex: 1, startSec: 1, trimEndSec: 3 }),
    musicClip(),
  ];
  const t = timeline([v, music(0.5, 4)], clips, { adaptive: false, amountDb: 12 });

  it("treats the union of both clips as speaking, with the overlap summing as energy (+3 dB)", () => {
    const activity = buildVoiceActivity(t, baseGainOf);
    const one = activity.levelDb[Math.round(0.5 / activity.frameSec)];
    const both = activity.levelDb[Math.round(1.5 / activity.frameSec)];
    expect(both - one).toBeCloseTo(3.01, 1);
    expect(activeTransitions(curveFor(t, clips[2]))).toEqual(["on@0.00", "off@3.00"]);
  });

  it("never ducks more than the configured amount — the overlap does not double-duck", () => {
    const curve = curveFor(t, clips[2]);
    expect(maxReduction(curve)).toBeLessThanOrEqual(12 + 1e-6);
    expect(reductionAt(curve, 1.5)).toBeCloseTo(12, 1);
    expect(reductionAt(curve, 0.5)).toBeCloseTo(12, 0);
  });
});

describe("scenario: muted clips", () => {
  const v: AudioSource = { id: "v", name: "voice", buffer: makeConstantBuffer(VOICE_AMP, 4) };

  it("a muted voice clip does not duck the music at all", () => {
    const clips = [makeClipFixture({ id: "a", sourceId: "v", role: "voice", trimEndSec: 4, muted: true }), musicClip()];
    const curve = curveFor(timeline([v, music(0.5, 4)], clips), clips[1]);
    expect(curve.active.reduce((n, x) => n + x, 0)).toBe(0);
    expect(Array.from(curve.gain).every((g) => g === 1)).toBe(true);
  });

  it("a muted music clip contributes nothing to the adaptive measurement (and isn't rendered)", () => {
    const clips = [makeClipFixture({ id: "a", sourceId: "v", role: "voice", trimEndSec: 4 }), musicClip({ muted: true })];
    const t = timeline([v, music(0.5, 4)], clips);
    const levels = buildClipLevels(t, [clips[1]], baseGainOf);
    expect(Array.from(levels.levelDb).every((l) => l <= -90)).toBe(true);
  });

  it("un-muting the same voice clip restores ducking", () => {
    const clips = [makeClipFixture({ id: "a", sourceId: "v", role: "voice", trimEndSec: 4 }), musicClip()];
    const curve = curveFor(timeline([v, music(0.5, 4)], clips, { adaptive: false, amountDb: 12 }), clips[1]);
    expect(reductionAt(curve, 2)).toBeCloseTo(12, 1);
  });
});

describe("scenario: voice clip played at 1.5× and 2×", () => {
  // Source: 1 s speech, 1 s pause, 1 s speech. At speed s the pause must land at [1/s, 2/s).
  const v: AudioSource = {
    id: "v",
    name: "voice",
    buffer: makeSegmentedBuffer([
      [VOICE_AMP, 1],
      [0, 1],
      [VOICE_AMP, 1],
    ]),
  };

  for (const speed of [1, 1.5, 2]) {
    it(`at ${speed}× the speaking/pause boundaries follow the sped-up timing`, () => {
      const clips = [makeClipFixture({ id: "a", sourceId: "v", role: "voice", trimEndSec: 3, speed }), musicClip()];
      const t = timeline([v, music(0.5, 4)], clips, { attackSec: 0, releaseSec: 0, holdSec: 0 });
      const curve = curveFor(t, clips[1]);
      const frame = curve.frameSec;
      const expected = [0, 1 / speed, 2 / speed, 3 / speed];
      const got = activeTransitions(curve).map((s) => Number(s.split("@")[1]));
      expect(got.length).toBe(4);
      got.forEach((sec, i) => expect(Math.abs(sec - expected[i])).toBeLessThanOrEqual(frame + 1e-9));
      expect(curve.totalSec).toBeCloseTo(Math.max(3 / speed, 4), 5);
    });
  }

  it("a trimmed voice clip does not read source audio past its out-point (even at 2×)", () => {
    // 1 s of silence followed by loud material; the clip keeps only the silent first second.
    const src: AudioSource = {
      id: "v",
      name: "voice",
      buffer: makeSegmentedBuffer([
        [0, 1],
        [0.9, 1],
      ]),
    };
    const clips = [makeClipFixture({ id: "a", sourceId: "v", role: "voice", trimEndSec: 1, speed: 2 }), musicClip()];
    const curve = curveFor(timeline([src, music(0.5, 4)], clips), clips[1]);
    expect(curve.active.reduce((n, x) => n + x, 0)).toBe(0);
  });
});

describe("scenario: short pauses between words", () => {
  // Eight 250 ms "words" with 150 ms gaps, then a 2 s pause, then one more word.
  const segs: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) segs.push([VOICE_AMP, 0.25], [0, 0.15]);
  segs.push([0, 2], [VOICE_AMP, 1]);
  const v: AudioSource = { id: "v", name: "voice", buffer: makeSegmentedBuffer(segs) };
  const voiceClip = makeClipFixture({ id: "a", sourceId: "v", role: "voice", trimEndSec: v.buffer.duration });
  const t = timeline([v, music(0.5, v.buffer.duration)], [voiceClip, musicClip({ trimEndSec: v.buffer.duration })], {
    adaptive: false,
    amountDb: 12,
  });
  const curve = curveFor(t, t.clips[1]);

  it("stays fully ducked through the word gaps — no pumping", () => {
    const run = Array.from(curve.reductionDb.slice(frameAt(curve, 0.6), frameAt(curve, 3.2)));
    const swing = Math.max(...run) - Math.min(...run);
    expect(swing).toBeLessThan(0.5);
    expect(Math.min(...run)).toBeGreaterThan(11.5);
  });

  it("only releases once the voice has been quiet for longer than the hold", () => {
    const endOfRun = 3.05; // the 8th word ends here (8 × 0.4 s cycle, minus the trailing gap)
    expect(reductionAt(curve, endOfRun + DEFAULT_DUCKING.holdSec - 0.1)).toBeGreaterThan(11.5);
    expect(reductionAt(curve, endOfRun + DEFAULT_DUCKING.holdSec + 0.6)).toBeLessThan(8);
    expect(reductionAt(curve, 4.9)).toBeLessThan(3);
  });

  it("starts the duck before the next phrase (look-ahead) so the onset isn't masked", () => {
    const onset = 5.2;
    // Most of the way down by the time the word starts, not just beginning to move.
    expect(reductionAt(curve, onset)).toBeGreaterThan(7);
    // …and still untouched well before it.
    expect(reductionAt(curve, onset - 0.5)).toBeLessThan(3);
  });
});

describe("scenario: music that is already quieter than the voice (adaptive ducking)", () => {
  const v: AudioSource = { id: "v", name: "voice", buffer: makeConstantBuffer(VOICE_AMP, 4) }; // -10.5 dBFS
  const voiceClip = makeClipFixture({ id: "a", sourceId: "v", role: "voice", trimEndSec: 4 });
  const withMusic = (amp: number, ducking: Partial<DuckingSettings> = {}) => {
    const clips = [voiceClip, musicClip()];
    return curveFor(timeline([v, music(amp, 4)], clips, ducking), clips[1]);
  };

  it("leaves music that's already 30 dB under the voice completely alone", () => {
    const curve = withMusic(0.01); // -40 dBFS
    expect(maxReduction(curve)).toBe(0);
    expect(Array.from(curve.gain).every((g) => g === 1)).toBe(true);
  });

  it("ducks music 4 dB under the voice by just the 6 dB needed to reach the 10 dB margin", () => {
    expect(reductionAt(withMusic(0.19), 2)).toBeCloseTo(6, 0); // -14.4 dBFS
  });

  it("ducks music at the voice's own level by the full margin", () => {
    expect(reductionAt(withMusic(VOICE_AMP), 2)).toBeCloseTo(10, 0);
  });

  it("caps at the max amount for music far louder than the voice", () => {
    expect(reductionAt(withMusic(0.95), 2)).toBeCloseTo(DEFAULT_DUCKING.amountDb, 0); // would need ~20 dB
  });

  it("honours the 'keep under' margin setting", () => {
    expect(reductionAt(withMusic(VOICE_AMP, { keepUnderDb: 6 }), 2)).toBeCloseTo(6, 0);
  });

  it("follows the music's own dynamics: quiet intro untouched, loud section ducked", () => {
    const m: AudioSource = {
      id: "m",
      name: "music",
      buffer: makeSegmentedBuffer([
        [0.03, 2],
        [0.6, 2],
      ]),
    }; // -30 then -4.4 dBFS
    const clips = [voiceClip, musicClip()];
    const curve = curveFor(timeline([v, m], clips), clips[1]);
    expect(reductionAt(curve, 0.8)).toBeLessThan(0.5);
    expect(reductionAt(curve, 3.5)).toBeCloseTo(16, 0);
  });

  it("adaptive off = the old fixed behaviour, quiet music included", () => {
    expect(reductionAt(withMusic(0.01, { adaptive: false, amountDb: 12 }), 2)).toBeCloseTo(12, 1);
  });

  it("a music clip at half speed gets the same timeline-aligned curve", () => {
    const clips = [voiceClip, musicClip({ speed: 0.5, trimEndSec: 2 })];
    const curve = curveFor(timeline([v, music(VOICE_AMP, 4)], clips), clips[1]);
    expect(reductionAt(curve, 2)).toBeCloseTo(10, 0);
  });
});
