// The multi-track audio editor's own model. Unlike timeline-core's sequential clip layout, clips
// here carry an absolute `startSec` and may overlap freely — within a lane and across lanes. Lanes
// are purely visual rows; the mix sums every clip regardless of lane.

export interface AudioSource {
  id: string;
  name: string;
  /** Decoded once and shared: the same file dropped twice references one buffer. */
  buffer: AudioBuffer;
}

export interface AudioClip {
  id: string;
  sourceId: string;
  name: string;
  laneIndex: number;
  /** Absolute position of the clip's left edge on the timeline, seconds. */
  startSec: number;
  /** In/out points within the source buffer, seconds. */
  trimStartSec: number;
  trimEndSec: number;
  gainDb: number;
  normalize: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  speed: number;
  muted: boolean;
}

export interface AudioTimeline {
  sources: AudioSource[];
  clips: AudioClip[];
  laneCount: number;
}

export const MIN_CLIP_SEC = 0.05;
export const DEFAULT_LANE_COUNT = 3;

export function clipVisibleDuration(clip: AudioClip): number {
  return Math.max(0, (clip.trimEndSec - clip.trimStartSec) / (clip.speed > 0 ? clip.speed : 1));
}

export function clipEnd(clip: AudioClip): number {
  return clip.startSec + clipVisibleDuration(clip);
}

export function timelineDuration(timeline: AudioTimeline): number {
  return timeline.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function sourceById(timeline: AudioTimeline, id: string): AudioSource | undefined {
  return timeline.sources.find((s) => s.id === id);
}

// A fresh full-length clip for a source, dropped at `startSec` on `laneIndex`.
export function makeClip(source: AudioSource, laneIndex: number, startSec: number): AudioClip {
  return {
    id: crypto.randomUUID(),
    sourceId: source.id,
    name: source.name,
    laneIndex,
    startSec: Math.max(0, startSec),
    trimStartSec: 0,
    trimEndSec: source.buffer.duration,
    gainDb: 0,
    normalize: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    speed: 1,
    muted: false,
  };
}

// Split `clip` at absolute time `atSec` into [left, right]. `atSec` must be strictly inside the
// clip. The cut point in source time accounts for speed.
export function splitClipAt(clip: AudioClip, atSec: number): [AudioClip, AudioClip] | null {
  const start = clip.startSec;
  const end = clipEnd(clip);
  if (atSec <= start + MIN_CLIP_SEC || atSec >= end - MIN_CLIP_SEC) return null;
  const speed = clip.speed > 0 ? clip.speed : 1;
  const cutSourceSec = clip.trimStartSec + (atSec - start) * speed;
  const left: AudioClip = { ...clip, trimEndSec: cutSourceSec, fadeOutSec: 0 };
  const right: AudioClip = {
    ...clip,
    id: crypto.randomUUID(),
    startSec: atSec,
    trimStartSec: cutSourceSec,
    fadeInSec: 0,
  };
  return [left, right];
}

// Snap `value` to the nearest candidate within `thresholdPx` (converted through `pxPerSec`).
export function snap(value: number, candidates: number[], pxPerSec: number, thresholdPx = 6): number {
  let best = value;
  let bestDist = thresholdPx / pxPerSec;
  for (const c of candidates) {
    const dist = Math.abs(value - c);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}
