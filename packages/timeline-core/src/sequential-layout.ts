import type { Clip } from "@reel-studio/shared-types";

export interface LaidOutClip extends Clip {
  timelineStart: number;
  duration: number;
}

// A clip's transitionOutSeconds pulls the next clip's start earlier, creating an overlap window
// between them — clamped to at most half of either clip's own duration so a transition can never
// consume a whole clip or cross past its midpoint.
function clampedOverlap(duration: number, nextDuration: number, requested: number): number {
  return Math.max(0, Math.min(requested, duration / 2, nextDuration / 2));
}

export function layoutSequentialClips(clips: Clip[]): LaidOutClip[] {
  let cursor = 0;
  const laidOut: LaidOutClip[] = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const duration = (clip.outPoint - clip.inPoint) / clip.speed;
    laidOut.push({ ...clip, timelineStart: cursor, duration });

    const next = clips[i + 1];
    if (next) {
      const nextDuration = (next.outPoint - next.inPoint) / next.speed;
      cursor += duration - clampedOverlap(duration, nextDuration, clip.transitionOutSeconds);
    } else {
      cursor += duration;
    }
  }
  return laidOut;
}

export interface ActiveClip {
  clip: LaidOutClip;
  localTime: number;
  index: number;
}

export function findActiveClip(laidOutClips: LaidOutClip[], time: number): ActiveClip | null {
  for (let index = 0; index < laidOutClips.length; index++) {
    const clip = laidOutClips[index];
    const end = clip.timelineStart + clip.duration;
    if (time >= clip.timelineStart && time < end) {
      const localTime = clip.inPoint + (time - clip.timelineStart) * clip.speed;
      return { clip, localTime, index };
    }
  }
  return null;
}

export function getSequenceDuration(laidOutClips: LaidOutClip[]): number {
  if (laidOutClips.length === 0) return 0;
  const last = laidOutClips[laidOutClips.length - 1];
  return last.timelineStart + last.duration;
}

// How much clip `a`'s timeline range overlaps the very next clip `b`'s range — derived purely from
// their laid-out timing (not transitionOutSeconds directly), so preview and export read one source
// of truth for "how long is the transition here" instead of re-deriving/clamping it twice.
export function getOverlapSeconds(a: LaidOutClip, b: LaidOutClip): number {
  return Math.max(0, a.timelineStart + a.duration - b.timelineStart);
}

export interface ActiveTransition {
  outgoing: ActiveClip;
  incoming: ActiveClip;
  /** 0 at the start of the transition, 1 at the end. */
  progress: number;
}

// Detects whether `time` falls inside the overlap window between two consecutive clips, for
// cross-dissolve rendering. Returns null outside any overlap (the ordinary single-active-clip case).
export function findTransitionAt(laidOutClips: LaidOutClip[], time: number): ActiveTransition | null {
  for (let i = 0; i < laidOutClips.length - 1; i++) {
    const a = laidOutClips[i];
    const b = laidOutClips[i + 1];
    const overlapStart = b.timelineStart;
    const overlapEnd = a.timelineStart + a.duration;
    if (overlapEnd <= overlapStart) continue;
    if (time >= overlapStart && time < overlapEnd) {
      return {
        outgoing: { clip: a, localTime: a.inPoint + (time - a.timelineStart) * a.speed, index: i },
        incoming: { clip: b, localTime: b.inPoint + (time - b.timelineStart) * b.speed, index: i + 1 },
        progress: (time - overlapStart) / (overlapEnd - overlapStart),
      };
    }
  }
  return null;
}
