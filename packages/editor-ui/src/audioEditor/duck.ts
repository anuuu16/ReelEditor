// Auto-ducking: pulls "music"/"sfx" clips down while a "voice" clip is actually speaking, and lets
// them back up once it isn't — the thing a human editor does by hand with a pile of volume
// keyframes every time a voiceover sits on top of a music bed.
//
// How it works (a cheap, client-side approximation of a sidechain compressor):
//   1. Sample every non-muted "voice" clip's resolved level (its own gain/normalize/fades applied)
//      in short frames across the whole timeline -> `buildVoiceActivity`.
//   2. Threshold that into "speaking" / "not speaking" per frame -> `gateActivity`, then widen it:
//      backwards by a look-ahead (we're offline, so the music can start dipping just *before* the
//      first word instead of lagging it) and forwards by a hold time (so the 100–400 ms gaps between
//      words/sentences don't make the music pump up and back down) -> `extendActivity`.
//   3. Decide how much to duck each frame -> `duckTargets`: either a fixed amount, or (adaptive
//      mode) only as much as this particular backing clip needs to sit `keepUnderDb` below the
//      voice — backing that's already quiet enough is left alone, loud backing gets the full amount.
//   4. Ease the per-frame targets with attack/release time constants exactly like a compressor's
//      envelope follower -> `smoothTowardTargets`, and turn the resulting dB-reduction curve into a
//      plain gain multiplier curve that mixdown.ts feeds into that clip's own gain node via
//      setValueCurveAtTime.
//
// See the file-level comment in mixdown.ts for why this (vs. a "real" DSP sidechain compressor, or
// doing it server-side in ffmpeg) is the practical choice here, and what the more-robust
// alternative would look like.
import { dbToGain, gainToDb } from "./dbUtils.js";
import { computeRmsAmplitude } from "./waveform.js";
import {
  clipEnd,
  clipVisibleDuration,
  sourceById,
  timelineDuration,
  type AudioClip,
  type AudioSource,
  type AudioTimeline,
} from "./timeline.js";

/** Frames per second of the analysis grid — fine enough to track speech cadence, coarse enough to
 * stay cheap on a several-minute timeline. */
export const DUCK_FRAME_SEC = 0.05;

/** Per-frame level (dBFS) of some set of clips across the whole timeline. */
export interface LevelTrack {
  frameSec: number;
  totalSec: number;
  /** One entry per frame: the combined level at that instant, in dBFS; -90 where nothing plays. */
  levelDb: Float32Array;
}

/** The voice clips' LevelTrack — what ducking keys off. (Same shape; the alias just reads better.) */
export type VoiceActivity = LevelTrack;

export const SILENT_DB = -90;

// The linear gain multiplier (post base-gain, post-fade) a clip is actually playing at timeline
// second `atSec` — mirrors the ramp math scheduleClip hands to the Web Audio gain node, so the
// envelope this drives matches what you'll actually hear rather than an idealized flat clip.
export function clipGainMultiplierAt(clip: AudioClip, baseGain: number, atSec: number): number {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const visible = clipVisibleDuration(clip);
  const pos = atSec - clip.startSec;
  if (pos < 0 || pos > visible) return 0;
  const regionDur = (clip.trimEndSec - clip.trimStartSec) / speed;
  const fadeIn = Math.min(Math.max(clip.fadeInSec, 0), regionDur / 2) / speed;
  const fadeOut = Math.min(Math.max(clip.fadeOutSec, 0), regionDur / 2) / speed;
  let mult = 1;
  if (fadeIn > 0 && pos < fadeIn) mult = Math.min(mult, pos / fadeIn);
  const fromEnd = visible - pos;
  if (fadeOut > 0 && fromEnd < fadeOut) mult = Math.min(mult, fromEnd / fadeOut);
  return baseGain * mult;
}

// Per-frame combined level (dBFS) of `clips` across the timeline, `baseGainOf` resolving each
// clip's own gain/normalize (mixdown.ts already knows how — passed in rather than duplicated
// here). Overlapping clips combine as independent energy sources (sqrt of summed squares), same as
// how they'd actually sum at the speaker. Speed is honoured: a 2× clip reads twice as much source
// per frame, so its pauses land where they'll actually be heard.
export function buildClipLevels(
  timeline: AudioTimeline,
  clips: AudioClip[],
  baseGainOf: (clip: AudioClip, source: AudioSource) => number,
  frameSec: number = DUCK_FRAME_SEC,
): LevelTrack {
  const totalSec = Math.max(0.1, timelineDuration({ ...timeline, clips: timeline.clips.filter((c) => !c.muted) }));
  const frameCount = Math.max(1, Math.ceil(totalSec / frameSec));
  const levelDb = new Float32Array(frameCount).fill(SILENT_DB);

  for (const clip of clips) {
    if (clip.muted || clipVisibleDuration(clip) <= 0) continue;
    const source = sourceById(timeline, clip.sourceId);
    if (!source) continue;
    const buffer = source.buffer;
    const base = baseGainOf(clip, source);
    const speed = clip.speed > 0 ? clip.speed : 1;
    const startFrame = Math.max(0, Math.floor(clip.startSec / frameSec));
    const endFrame = Math.min(frameCount, Math.ceil(clipEnd(clip) / frameSec));
    for (let f = startFrame; f < endFrame; f++) {
      const tStart = f * frameSec;
      const tEnd = tStart + frameSec;
      // Clamped to the trimmed region: the last frame can overhang the clip's end, and must not
      // read whatever comes after the out-point in the source file.
      const srcStart = Math.max(clip.trimStartSec, clip.trimStartSec + (tStart - clip.startSec) * speed);
      const srcEnd = Math.min(clip.trimEndSec, clip.trimStartSec + (tEnd - clip.startSec) * speed);
      if (srcEnd <= srcStart) continue;
      const rms = computeRmsAmplitude(buffer, srcStart, srcEnd);
      const mult = clipGainMultiplierAt(clip, base, Math.min(clipEnd(clip), (tStart + tEnd) / 2));
      const level = rms * mult;
      // Combine with whatever's already in this frame (another overlapping clip) as summed energy
      // rather than overwriting it.
      const existing = levelDb[f] > SILENT_DB ? dbToGain(levelDb[f]) : 0;
      levelDb[f] = gainToDb(Math.sqrt(existing * existing + level * level));
    }
  }
  return { frameSec, totalSec, levelDb };
}

export function buildVoiceActivity(
  timeline: AudioTimeline,
  baseGainOf: (clip: AudioClip, source: AudioSource) => number,
  frameSec: number = DUCK_FRAME_SEC,
): VoiceActivity {
  return buildClipLevels(
    timeline,
    timeline.clips.filter((c) => c.role === "voice"),
    baseGainOf,
    frameSec,
  );
}

/** "Speaking" per frame: level above the threshold. */
export function gateActivity(levelDb: ArrayLike<number>, thresholdDb: number): Uint8Array {
  const active = new Uint8Array(levelDb.length);
  for (let i = 0; i < levelDb.length; i++) active[i] = levelDb[i] > thresholdDb ? 1 : 0;
  return active;
}

// Widens each active stretch: `lookaheadSec` earlier (so the duck is already most of the way in
// when the first word lands — only possible because the whole mix is rendered offline) and
// `holdSec` later (so a pause shorter than the hold never lets the music back up at all — no
// pumping between words, and the release only begins once the voice has really stopped).
export function extendActivity(active: Uint8Array, frameSec: number, lookaheadSec: number, holdSec: number): Uint8Array {
  const n = active.length;
  const out = new Uint8Array(n);
  const ahead = Math.max(0, Math.round(lookaheadSec / frameSec));
  const hold = Math.max(0, Math.round(holdSec / frameSec));
  for (let i = 0; i < n; i++) {
    if (!active[i]) continue;
    for (let j = Math.max(0, i - ahead); j <= Math.min(n - 1, i + hold); j++) out[j] = 1;
  }
  return out;
}

// Power-mean (energy-domain) moving average of a dB track over `windowSec`, centred — the
// "short-term level" of a backing clip, tracking its quiet intro vs. loud chorus without reacting
// to individual beats. Frames at SILENT_DB count as zero energy.
export function smoothedLevelDb(levelDb: ArrayLike<number>, frameSec: number, windowSec: number): Float32Array {
  const n = levelDb.length;
  const half = Math.max(0, Math.round(windowSec / frameSec / 2));
  const power = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const g = levelDb[i] > SILENT_DB ? dbToGain(levelDb[i]) : 0;
    power[i + 1] = power[i] + g * g;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = gainToDb(Math.sqrt((power[b] - power[a]) / (b - a)));
  }
  return out;
}

/** Power-mean level (dB) of `levelDb` over the frames flagged in `mask`; SILENT_DB if none. */
export function meanLevelDbWhere(levelDb: ArrayLike<number>, mask: ArrayLike<number>): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < levelDb.length; i++) {
    if (!mask[i]) continue;
    const g = levelDb[i] > SILENT_DB ? dbToGain(levelDb[i]) : 0;
    sum += g * g;
    count++;
  }
  return count > 0 ? gainToDb(Math.sqrt(sum / count)) : SILENT_DB;
}

export interface DuckOptions {
  thresholdDb: number;
  amountDb: number;
  attackSec: number;
  releaseSec: number;
  holdSec: number;
  adaptive: boolean;
  keepUnderDb: number;
}

// Per-frame target reduction (dB, positive = quieter) before any attack/release easing.
//   fixed:    amountDb wherever (extended) voice activity says so, else 0.
//   adaptive: how much *this* backing clip must come down, right now, to sit keepUnderDb below
//             the voice — from the clip's own short-term level and the voice's typical speaking
//             level (one number across all its active frames, so syllable-to-syllable variation
//             doesn't wobble the music) — clamped to [0, amountDb]. Backing that's already far
//             enough under the voice therefore gets a target of 0: untouched.
export function duckTargets(
  voice: LevelTrack,
  rawActive: Uint8Array,
  extendedActive: Uint8Array,
  opts: DuckOptions,
  backing: LevelTrack | null,
): Float32Array {
  const n = rawActive.length;
  const targets = new Float32Array(n);
  if (!opts.adaptive || !backing) {
    for (let i = 0; i < n; i++) targets[i] = extendedActive[i] ? opts.amountDb : 0;
    return targets;
  }
  const voiceRefDb = meanLevelDbWhere(voice.levelDb, rawActive);
  const backingShortTerm = smoothedLevelDb(backing.levelDb, backing.frameSec, 1.0);
  const ceilingDb = voiceRefDb - opts.keepUnderDb;
  for (let i = 0; i < n; i++) {
    if (!extendedActive[i]) continue;
    const needed = backingShortTerm[i] - ceilingDb;
    targets[i] = Math.max(0, Math.min(opts.amountDb, needed));
  }
  return targets;
}

/** One-pole envelope follower toward a per-frame target (dB of reduction): rises with the attack
 * time constant, falls with the release one — a hard per-frame jump would read as a gate, not a
 * mix move. */
export function smoothTowardTargets(targets: ArrayLike<number>, frameSec: number, attackSec: number, releaseSec: number): Float32Array {
  const n = targets.length;
  const out = new Float32Array(n);
  // Standard one-pole envelope-follower coefficient: fraction of the remaining gap closed per
  // frame so the transition's time-constant is attackSec/releaseSec regardless of frameSec.
  const attackCoeff = attackSec > 0 ? 1 - Math.exp(-frameSec / attackSec) : 1;
  const releaseCoeff = releaseSec > 0 ? 1 - Math.exp(-frameSec / releaseSec) : 1;
  let current = 0;
  for (let i = 0; i < n; i++) {
    const target = targets[i];
    const coeff = target > current ? attackCoeff : releaseCoeff;
    current += (target - current) * coeff;
    out[i] = current;
  }
  return out;
}

/** Fixed-amount convenience over smoothTowardTargets: `amountDb` wherever `active`, else 0. */
export function smoothDuckReductionDb(
  active: ArrayLike<boolean> | ArrayLike<number>,
  frameSec: number,
  amountDb: number,
  attackSec: number,
  releaseSec: number,
): Float32Array {
  const targets = new Float32Array(active.length);
  for (let i = 0; i < active.length; i++) targets[i] = active[i] ? amountDb : 0;
  return smoothTowardTargets(targets, frameSec, attackSec, releaseSec);
}

export interface DuckCurve {
  frameSec: number;
  totalSec: number;
  /** Linear gain multiplier per frame to apply to the backing clip (1 = untouched). */
  gain: Float32Array;
  /** Whether voice was judged "speaking" that frame (raw, before look-ahead/hold) — exposed for
   * the mix-health meter, not just ducking. */
  active: Uint8Array;
  /** The per-frame dB reduction the gain curve was made from, for inspection/tests. */
  reductionDb: Float32Array;
}

// The duck curve for one backing clip. `backing` (that clip's own LevelTrack) is only needed for
// adaptive mode; without it the curve is the plain fixed-amount one, which is all the mix-health
// meter needs when it just wants the `active` mask.
export function buildDuckCurve(activity: VoiceActivity, opts: DuckOptions, backing: LevelTrack | null = null): DuckCurve {
  const active = gateActivity(activity.levelDb, opts.thresholdDb);
  // Look-ahead = the attack time: by the time the first word lands the duck is ~2/3 of the way in
  // rather than just starting.
  const extended = extendActivity(active, activity.frameSec, opts.attackSec, opts.holdSec);
  const targets = duckTargets(activity, active, extended, opts, backing);
  const reductionDb = smoothTowardTargets(targets, activity.frameSec, opts.attackSec, opts.releaseSec);
  const gain = new Float32Array(reductionDb.length);
  for (let i = 0; i < gain.length; i++) gain[i] = dbToGain(-reductionDb[i]);
  return { frameSec: activity.frameSec, totalSec: activity.totalSec, gain, active, reductionDb };
}

// Reads a duck curve's gain at an arbitrary timeline second, linearly interpolating between the
// two nearest frame samples — used to build the exact-length curve each clip's gain node needs.
export function sampleDuckGain(curve: Pick<DuckCurve, "frameSec" | "gain">, atSec: number): number {
  const { frameSec, gain } = curve;
  if (gain.length === 0) return 1;
  const pos = Math.max(0, atSec) / frameSec;
  const i0 = Math.min(gain.length - 1, Math.floor(pos));
  const i1 = Math.min(gain.length - 1, i0 + 1);
  const frac = pos - i0;
  return gain[i0] + (gain[i1] - gain[i0]) * frac;
}

// A fixed-length array of duck-gain samples spanning [fromSec, fromSec + durationSec) — exactly
// what AudioParam.setValueCurveAtTime wants for one clip's ducking automation.
export function sampleDuckGainCurve(
  curve: Pick<DuckCurve, "frameSec" | "gain">,
  fromSec: number,
  durationSec: number,
  count: number,
): Float32Array {
  const out = new Float32Array(Math.max(2, count));
  for (let i = 0; i < out.length; i++) {
    const t = fromSec + (durationSec * i) / (out.length - 1);
    out[i] = sampleDuckGain(curve, t);
  }
  return out;
}
