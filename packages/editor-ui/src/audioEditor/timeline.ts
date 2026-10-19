// The multi-track audio editor's own model. Unlike timeline-core's sequential clip layout, clips
// here carry an absolute `startSec` and may overlap freely — within a lane and across lanes. Lanes
// are purely visual rows; the mix sums every clip regardless of lane.

export interface AudioSource {
  id: string;
  name: string;
  /** Decoded once and shared: the same file dropped twice references one buffer. */
  buffer: AudioBuffer;
}

// What a clip *is*, for the mix's sake — not cosmetic: "Voice" clips are what auto-ducking watches
// for and what the mix-health meter treats as the thing everything else should stay under.
// "Music"/"SFX" clips are both duckable backing elements; they're kept distinct mainly so a future
// "duck music but not sfx" toggle (or vice versa) has something to key off without another migration.
export type AudioClipRole = "music" | "voice" | "sfx";

export const AUDIO_CLIP_ROLES: Array<{ id: AudioClipRole; label: string }> = [
  { id: "music", label: "Music" },
  { id: "voice", label: "Voice-over" },
  { id: "sfx", label: "SFX" },
];

// How "Normalize" resolves a clip's gain:
//  - "off": whatever gainDb says, nothing else.
//  - "peak": classic normalize — boost/cut so the clip's loudest sample hits NORMALIZE_PEAK_TARGET_DBFS.
//    Cheap and familiar, but two clips normalized to the same *peak* can still sound very
//    different in *loudness* (a squashed, brickwalled music bed vs. a dynamic voice recording) —
//    that mismatch is exactly what made "normalize" not actually fix a loud-music/quiet-voice mix.
//  - "loudness": boost/cut so the clip's average (RMS-ish) level hits LOUDNESS_NORMALIZE_TARGET_DB —
//    much closer to how loud something *sounds*, so it's the better default for balancing a voice
//    track against a music bed by ear-level rather than by transient peaks.
export type NormalizeMode = "off" | "peak" | "loudness";

export interface AudioClip {
  id: string;
  sourceId: string;
  name: string;
  laneIndex: number;
  role: AudioClipRole;
  /** Absolute position of the clip's left edge on the timeline, seconds. */
  startSec: number;
  /** In/out points within the source buffer, seconds. */
  trimStartSec: number;
  trimEndSec: number;
  gainDb: number;
  normalizeMode: NormalizeMode;
  fadeInSec: number;
  fadeOutSec: number;
  speed: number;
  muted: boolean;
}

// Auto-ducking: while any non-muted "voice" clip is audibly active, every non-muted "music"/"sfx"
// clip's gain is pulled down (eased in/out over `attackSec`/`releaseSec` so it isn't a jump-cut),
// held through short pauses between words (`holdSec`), then released once the voice has really
// gone quiet. See duck.ts for the actual envelope.
export interface DuckingSettings {
  enabled: boolean;
  /** How far to pull backing clips down while voice is active, in dB (positive = quieter). With
   * `adaptive` on this is the *maximum* — quieter backing gets ducked less, or not at all. */
  amountDb: number;
  /** Voice level (dBFS, roughly) above which it counts as "speaking" and ducking engages. */
  thresholdDb: number;
  /** Seconds to ease the duck IN once voice crosses the threshold. */
  attackSec: number;
  /** Seconds to ease the duck back OUT once voice drops back below the threshold. */
  releaseSec: number;
  /** Seconds to stay fully ducked after voice drops below the threshold before releasing — bridges
   * the gaps between words/sentences so the music doesn't pump up and down with every pause. */
  holdSec: number;
  /** Duck only as much as needed to keep backing `keepUnderDb` below the voice (capped at
   * `amountDb`), instead of always by the full amount — backing that's already quiet enough is
   * left alone. */
  adaptive: boolean;
  /** Adaptive mode's target: how far under the voice (dB) backing should sit while it's speaking. */
  keepUnderDb: number;
}

export const DEFAULT_DUCKING: DuckingSettings = {
  enabled: false,
  amountDb: 18,
  thresholdDb: -34,
  attackSec: 0.15,
  releaseSec: 0.6,
  holdSec: 0.4,
  adaptive: true,
  keepUnderDb: 10,
};

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
  ducking: DuckingSettings;
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
    role: "music",
    startSec: Math.max(0, startSec),
    trimStartSec: 0,
    trimEndSec: source.buffer.duration,
    gainDb: 0,
    normalizeMode: "off",
    fadeInSec: 0,
    fadeOutSec: 0,
    speed: 1,
    muted: false,
  };
}

// Fills in fields that didn't exist in older persisted projects (role/normalizeMode used to be a
// plain `normalize: boolean`; ducking didn't exist at all) so a project saved before this feature
// shipped still loads instead of rendering with `undefined` everywhere.
export function migrateClip(clip: AudioClip & { normalize?: boolean }): AudioClip {
  return {
    ...clip,
    role: clip.role ?? "music",
    normalizeMode: clip.normalizeMode ?? (clip.normalize ? "peak" : "off"),
  };
}

export function migrateDucking(ducking: Partial<DuckingSettings> | undefined): DuckingSettings {
  return { ...DEFAULT_DUCKING, ...ducking };
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
