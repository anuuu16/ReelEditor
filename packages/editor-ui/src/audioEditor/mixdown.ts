import { dbToGain, gainToDb, LOUDNESS_NORMALIZE_TARGET_DB, NORMALIZE_PEAK_TARGET_DBFS } from "./dbUtils.js";
import { buildClipLevels, buildDuckCurve, buildVoiceActivity, sampleDuckGainCurve, type DuckCurve, type VoiceActivity } from "./duck.js";
import { computeIntegratedLoudnessDb } from "./loudness.js";
import { computePeakAmplitude } from "./waveform.js";
import { clipVisibleDuration, sourceById, timelineDuration, type AudioClip, type AudioSource, type AudioTimeline } from "./timeline.js";

export { dbToGain, gainToDb };

// Resolve a clip's gain knobs (fixed dB + whichever Normalize mode) to one plain scalar multiplier
// on its *own* trimmed region — independent of anything else on the timeline. Ducking (below) is
// layered on top of this, separately, because it depends on other clips.
export function resolveClipBaseGain(clip: AudioClip, buffer: AudioBuffer): number {
  const fixed = dbToGain(clip.gainDb || 0);
  if (clip.normalizeMode === "peak") {
    const peak = computePeakAmplitude(buffer, clip.trimStartSec, clip.trimEndSec);
    return fixed * (peak > 0 ? dbToGain(NORMALIZE_PEAK_TARGET_DBFS) / peak : 1);
  }
  if (clip.normalizeMode === "loudness") {
    const loudness = computeIntegratedLoudnessDb(buffer, clip.trimStartSec, clip.trimEndSec);
    return fixed * dbToGain(LOUDNESS_NORMALIZE_TARGET_DB - loudness);
  }
  return fixed;
}

function offlineCtor(): typeof OfflineAudioContext {
  return (
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  );
}

// Wire one clip into an OfflineAudioContext at its timeline position: trimmed slice → speed →
// gain (constant + linear fade ramps) → [auto-duck, for music/sfx only] → destination. Fades are
// in source seconds, scaled by speed — same ordering as buildAudioEditFilter (afade before atempo).
function scheduleClip(ctx: OfflineAudioContext, clip: AudioClip, buffer: AudioBuffer, duck: DuckCurve | null): void {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const trimStart = Math.max(0, Math.min(clip.trimStartSec, buffer.duration));
  const trimEnd = Math.max(trimStart + 1 / buffer.sampleRate, Math.min(clip.trimEndSec, buffer.duration));
  const regionDur = trimEnd - trimStart;
  const outDur = regionDur / speed;
  const at = Math.max(0, clip.startSec);

  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.playbackRate.value = speed;

  const gainNode = ctx.createGain();
  const base = resolveClipBaseGain(clip, buffer);
  const fadeIn = Math.min(Math.max(clip.fadeInSec, 0), regionDur / 2) / speed;
  const fadeOut = Math.min(Math.max(clip.fadeOutSec, 0), regionDur / 2) / speed;

  const g = gainNode.gain;
  g.setValueAtTime(fadeIn > 0 ? 0 : base, at);
  if (fadeIn > 0) g.linearRampToValueAtTime(base, at + fadeIn);
  if (fadeOut > 0) {
    g.setValueAtTime(base, at + Math.max(fadeIn, outDur - fadeOut));
    g.linearRampToValueAtTime(0, at + outDur);
  }

  let tail = gainNode;
  if (duck && outDur > 0) {
    const duckNode = ctx.createGain();
    // ~20 automation points/sec is plenty to track the attack/release envelope smoothly without
    // generating a huge curve for a long backing track.
    const samples = Math.min(4000, Math.max(2, Math.ceil(outDur * 20)));
    duckNode.gain.setValueCurveAtTime(sampleDuckGainCurve(duck, at, outDur, samples), at, outDur);
    gainNode.connect(duckNode);
    tail = duckNode;
  }

  node.connect(gainNode);
  tail.connect(ctx.destination);
  node.start(at, trimStart, regionDur);
}

// The ducking curve for every backing clip that gets one (keyed by clip id) — empty when ducking
// is off or no voice clip ever crosses the threshold. Each backing clip gets its own curve:
// adaptive ducking only pulls a clip down as far as *that* clip's own level needs, so a quiet pad
// and a loud drum loop under the same voice-over end up with different curves. Used by mixdown()
// for the actual gain automation and by the timeline to draw the dip onto each clip's waveform.
export function computeDuckCurves(timeline: AudioTimeline): Map<string, DuckCurve> {
  const curves = new Map<string, DuckCurve>();
  if (!timeline.ducking.enabled) return curves;
  const allClips = timeline.clips.filter((c) => !c.muted && clipVisibleDuration(c) > 0);
  const backingClips = allClips.filter((c) => c.role !== "voice");
  if (backingClips.length === 0) return curves;
  const baseGainOf = (clip: AudioClip, source: AudioSource) => resolveClipBaseGain(clip, source.buffer);
  const analysisTimeline = { ...timeline, clips: allClips };
  const activity: VoiceActivity = buildVoiceActivity(analysisTimeline, baseGainOf);
  // Nothing to duck under if no voice clip ever crosses the threshold — skip the per-clip work.
  if (!activity.levelDb.some((l) => l > timeline.ducking.thresholdDb)) return curves;
  for (const clip of backingClips) {
    const backing = timeline.ducking.adaptive ? buildClipLevels(analysisTimeline, [clip], baseGainOf) : null;
    curves.set(clip.id, buildDuckCurve(activity, timeline.ducking, backing));
  }
  return curves;
}

export interface MixdownOptions {
  /** Restrict rendering to a subset of the timeline's clips (e.g. "just the voice clips", for the
   * mix-health meter) while still computing the ducking envelope from ALL of the timeline's voice
   * clips — so a music-only analysis render still ducks exactly like the real mix would. */
  clipFilter?: (clip: AudioClip) => boolean;
}

// Flatten the whole timeline to a single stereo AudioBuffer — used for preview playback and as the
// intermediate for every export format. Also the analysis primitive: called with a role filter (no
// other changes) it renders an isolated "what does just the voice/music sound like" mix, which is
// how the mix-health meter measures whether music is masking the voice-over without duplicating the
// gain/fade/ducking math anywhere else.
export async function mixdown(timeline: AudioTimeline, opts?: MixdownOptions): Promise<AudioBuffer> {
  const allClips = timeline.clips.filter((c) => !c.muted && clipVisibleDuration(c) > 0);
  const renderClips = opts?.clipFilter ? allClips.filter(opts.clipFilter) : allClips;
  const total = Math.max(0.1, timelineDuration({ ...timeline, clips: allClips }));
  const sampleRate = timeline.sources.reduce((max, s) => Math.max(max, s.buffer.sampleRate), 0) || 44100;

  const duckCurves = computeDuckCurves(timeline);

  const Ctor = offlineCtor();
  const ctx = new Ctor(2, Math.ceil(total * sampleRate), sampleRate);
  for (const clip of renderClips) {
    const source = sourceById(timeline, clip.sourceId);
    if (source) scheduleClip(ctx, clip, source.buffer, duckCurves.get(clip.id) ?? null);
  }
  return ctx.startRendering();
}

// A slice of one source's samples, for a clip's mini-waveform without re-decoding.
export function sliceChannelData(source: AudioSource, startSec: number, endSec: number): Float32Array {
  const sr = source.buffer.sampleRate;
  const s = Math.max(0, Math.floor(startSec * sr));
  const e = Math.min(source.buffer.length, Math.ceil(endSec * sr));
  return source.buffer.getChannelData(0).subarray(s, Math.max(s + 1, e));
}
