import type { ProjectModel, Track } from "@reel-studio/shared-types";
import { getSequenceDuration, layoutSequentialClips, type LaidOutClip } from "./sequential-layout.js";

export function getTracksByKind(project: ProjectModel, kind: Track["kind"]): Track[] {
  return project.tracks.filter((t) => t.kind === kind).sort((a, b) => a.order - b.order);
}

export function layoutTrackClips(project: ProjectModel, trackId: string): LaidOutClip[] {
  return layoutSequentialClips(project.clips.filter((c) => c.trackId === trackId));
}

// Total project duration = the longest of the video track and every audio track (each audio
// track plays independently/concurrently, so two overlapping tracks don't add durations together).
export function getProjectDuration(project: ProjectModel, extraEnds: number[] = []): number {
  const videoTrack = getTracksByKind(project, "video")[0];
  const audioTracks = getTracksByKind(project, "audio");
  const durations = [
    videoTrack ? getSequenceDuration(layoutTrackClips(project, videoTrack.id)) : 0,
    ...audioTracks.map((t) => getSequenceDuration(layoutTrackClips(project, t.id))),
    ...extraEnds,
  ];
  return Math.max(0, ...durations);
}
