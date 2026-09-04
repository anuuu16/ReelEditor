import { computePeakAmplitude } from "./waveform.js";
import { clipVisibleDuration, sourceById, timelineDuration, type AudioClip, type AudioSource, type AudioTimeline } from "./timeline.js";

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export const NORMALIZE_TARGET_DBFS = -1;

// Resolve Normalize to a plain scalar: the ratio that brings the clip's own trimmed region peak
// to NORMALIZE_TARGET_DBFS.
export function normalizeScalar(clip: AudioClip, buffer: AudioBuffer): number {
  const peak = computePeakAmplitude(buffer, clip.trimStartSec, clip.trimEndSec);
  return peak > 0 ? dbToGain(NORMALIZE_TARGET_DBFS) / peak : 1;
}

function offlineCtor(): typeof OfflineAudioContext {
  return (
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  );
}

// Wire one clip into an OfflineAudioContext at its timeline position: trimmed slice → speed → gain
// (constant + linear fade ramps) → destination. Fades are in source seconds, scaled by speed —
// same ordering as buildAudioEditFilter (afade before atempo).
function scheduleClip(ctx: OfflineAudioContext, clip: AudioClip, buffer: AudioBuffer): void {
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
  const base = dbToGain(clip.gainDb || 0) * (clip.normalize ? normalizeScalar(clip, buffer) : 1);
  const fadeIn = Math.min(Math.max(clip.fadeInSec, 0), regionDur / 2) / speed;
  const fadeOut = Math.min(Math.max(clip.fadeOutSec, 0), regionDur / 2) / speed;

  const g = gainNode.gain;
  g.setValueAtTime(fadeIn > 0 ? 0 : base, at);
  if (fadeIn > 0) g.linearRampToValueAtTime(base, at + fadeIn);
  if (fadeOut > 0) {
    g.setValueAtTime(base, at + Math.max(fadeIn, outDur - fadeOut));
    g.linearRampToValueAtTime(0, at + outDur);
  }

  node.connect(gainNode).connect(ctx.destination);
  node.start(at, trimStart, regionDur);
}

// Flatten the whole timeline to a single stereo AudioBuffer — used for preview playback and as the
// intermediate for every export format.
export async function mixdown(timeline: AudioTimeline): Promise<AudioBuffer> {
  const clips = timeline.clips.filter((c) => !c.muted && clipVisibleDuration(c) > 0);
  const total = Math.max(0.1, timelineDuration({ ...timeline, clips }));
  const sampleRate = timeline.sources.reduce((max, s) => Math.max(max, s.buffer.sampleRate), 0) || 44100;

  const Ctor = offlineCtor();
  const ctx = new Ctor(2, Math.ceil(total * sampleRate), sampleRate);
  for (const clip of clips) {
    const source = sourceById(timeline, clip.sourceId);
    if (source) scheduleClip(ctx, clip, source.buffer);
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
