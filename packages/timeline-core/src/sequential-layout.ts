import type { Clip } from "@reel-studio/shared-types";

export interface LaidOutClip extends Clip {
  timelineStart: number;
  duration: number;
}

export function layoutSequentialClips(clips: Clip[]): LaidOutClip[] {
  let cursor = 0;
  const laidOut: LaidOutClip[] = [];
  for (const clip of clips) {
    const duration = (clip.outPoint - clip.inPoint) / clip.speed;
    laidOut.push({ ...clip, timelineStart: cursor, duration });
    cursor += duration;
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
