import type { ProjectModel, Track } from "@reel-studio/shared-types";
import { getSequenceDuration, layoutSequentialClips, type LaidOutClip } from "./sequential-layout.js";

export function getTracksByKind(project: ProjectModel, kind: Track["kind"]): Track[] {
  return project.tracks.filter((t) => t.kind === kind).sort((a, b) => a.order - b.order);
}

export function layoutTrackClips(project: ProjectModel, trackId: string): LaidOutClip[] {
  return layoutSequentialClips(project.clips.filter((c) => c.trackId === trackId));
}

// When the last overlay (title/logo) ends — overlays live on the timeline independently of any
// clip, so a title can outlast every clip and still needs to be played and exported.
export function getOverlaysEnd(project: ProjectModel): number {
  return project.overlays.reduce((end, o) => Math.max(end, o.end), 0);
}

// Total project duration = the longest of the video track, every audio track, and the last overlay
// end (each audio track plays independently/concurrently, so two overlapping tracks don't add
// durations together). This is THE definition of "how long is this reel": the preview player, the
// timeline ruler, the transport, the export panel and the ffmpeg render plan all read it, so what
// plays in the editor and what comes out of an export can never disagree on length.
export function getProjectDuration(project: ProjectModel): number {
  const videoTrack = getTracksByKind(project, "video")[0];
  const audioTracks = getTracksByKind(project, "audio");
  const durations = [
    videoTrack ? getSequenceDuration(layoutTrackClips(project, videoTrack.id)) : 0,
    ...audioTracks.map((t) => getSequenceDuration(layoutTrackClips(project, t.id))),
    getOverlaysEnd(project),
  ];
  return Math.max(0, ...durations);
}
