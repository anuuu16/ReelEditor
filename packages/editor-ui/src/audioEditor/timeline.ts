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

// A time-anchored comment — e.g. "AI extended music starts here" — independent of any lane or
// clip, shown as a small marker on the timeline that opens a popover with its text.
export interface TimelineNote {
  id: string;
  atSec: number;
  text: string;
}

export interface AudioTimeline {
  sources: AudioSource[];
  clips: AudioClip[];
  notes: TimelineNote[];
  laneCount: number;
}

export const MIN_CLIP_SEC = 0.05;
export const DEFAULT_LANE_COUNT = 3;
export const MIN_PX_PER_SEC = 20;
export const MAX_PX_PER_SEC = 400;
// Custom drag-data type carrying a source id when dragging a Sources-list entry onto the timeline
// (distinct from a native OS file drag, which the timeline handles separately via dataTransfer.files).
export const SOURCE_DRAG_TYPE = "application/x-audio-source-id";

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

export interface Gap {
  laneIndex: number;
  startSec: number;
  endSec: number;
}

// The empty stretch (if any) on `laneIndex` that contains `atSec` — bounded by that lane's
// previous clip's end (or 0, for the lane's leading space) and its next clip's start. A trailing
// gap after the lane's last clip is never returned: there's nothing after it to ripple shut.
export function findGapInLane(timeline: AudioTimeline, laneIndex: number, atSec: number): Gap | null {
  const laneClips = timeline.clips.filter((c) => c.laneIndex === laneIndex).sort((a, b) => a.startSec - b.startSec);
  let prevEnd = 0;
  for (const clip of laneClips) {
    if (atSec >= prevEnd && atSec < clip.startSec) {
      return clip.startSec - prevEnd > MIN_CLIP_SEC ? { laneIndex, startSec: prevEnd, endSec: clip.startSec } : null;
    }
    prevEnd = Math.max(prevEnd, clipEnd(clip));
  }
  return null;
}

// Removes [gap.startSec, gap.endSec) from the whole timeline, shifting every clip that starts at
// or after the gap left by its duration — across every lane, so lanes stay in sync with each other
// instead of drifting apart as gaps on one lane get closed independently of the others.
export function closeTimelineGap(timeline: AudioTimeline, gap: Gap): AudioTimeline {
  const shiftBy = gap.endSec - gap.startSec;
  return {
    ...timeline,
    clips: timeline.clips.map((c) => (c.startSec >= gap.endSec - MIN_CLIP_SEC ? { ...c, startSec: c.startSec - shiftBy } : c)),
  };
}

// Deletes `clipId` and closes the hole it leaves behind, across every lane (same ripple as
// closeTimelineGap — a plain delete would just leave that stretch empty).
export function rippleDeleteClip(timeline: AudioTimeline, clipId: string): AudioTimeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;
  const cutEnd = clipEnd(clip);
  const shiftBy = cutEnd - clip.startSec;
  return {
    ...timeline,
    clips: timeline.clips
      .filter((c) => c.id !== clipId)
      .map((c) => (c.startSec >= cutEnd - MIN_CLIP_SEC ? { ...c, startSec: c.startSec - shiftBy } : c)),
  };
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
