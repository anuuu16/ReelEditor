import type { ProjectModel, Track } from "@reel-studio/shared-types";
import { getSequenceDuration, layoutSequentialClips, type LaidOutClip } from "./sequential-layout.js";

export function getTracksByKind(project: ProjectModel, kind: Track["kind"]): Track[] {
  return project.tracks.filter((t) => t.kind === kind).sort((a, b) => a.order - b.order);
}

// The one video lane the editor shows and plays (and therefore the one the export renders).
export function getPrimaryVideoTrack(project: ProjectModel): Track | undefined {
  return getTracksByKind(project, "video")[0];
}

export function layoutTrackClips(project: ProjectModel, trackId: string): LaidOutClip[] {
  return layoutSequentialClips(project.clips.filter((c) => c.trackId === trackId));
}

// Total project duration = the longest of the video track and every audio track (each audio
// track plays independently/concurrently, so two overlapping tracks don't add durations together).
export function getProjectDuration(project: ProjectModel, extraEnds: number[] = []): number {
  const videoTrack = getPrimaryVideoTrack(project);
  const audioTracks = getTracksByKind(project, "audio");
  const durations = [
    videoTrack ? getSequenceDuration(layoutTrackClips(project, videoTrack.id)) : 0,
    ...audioTracks.map((t) => getSequenceDuration(layoutTrackClips(project, t.id))),
    ...extraEnds,
  ];
  return Math.max(0, ...durations);
}

export function getOverlaysEnd(project: ProjectModel): number {
  return project.overlays.reduce((end, o) => Math.max(end, o.end), 0);
}

// Just the video track's own length — the one lane `endBehavior: "trim"` measures the whole reel
// against, and the one the player/export hold the last frame of for `endBehavior: "freeze"`.
export function getVideoSequenceDuration(project: ProjectModel): number {
  const videoTrack = getPrimaryVideoTrack(project);
  return videoTrack ? getSequenceDuration(layoutTrackClips(project, videoTrack.id)) : 0;
}

// THE length of the reel: how long the preview plays, what the timeline ruler/transport show, and
// exactly how long the exported file is. Every one of those reads this single function so they can
// never disagree — e.g. a 12 s title over a 4 s clip and 9 s of music is a 12 s reel everywhere,
// with the video track's `endBehavior` (black, frozen, or cut off) filling the time after it ends.
//
// `endBehavior: "trim"` is the one choice that changes this length itself rather than just what's
// drawn during it: the reel becomes exactly as long as the video track, so a title or a longer
// piece of music past that point isn't just visually covered up — it never plays at all, in the
// preview or the export.
export function getTimelineDuration(project: ProjectModel): number {
  if (project.endBehavior === "trim") return getVideoSequenceDuration(project);
  return getProjectDuration(project, [getOverlaysEnd(project)]);
}
