import { layoutSequentialClips } from "@reel-studio/timeline-core";
import type { EditorState } from "./EditorContext.js";
import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "./initialProject.js";

export function computeSnapTargets(state: EditorState, excludeOverlayId?: string): number[] {
  const targets: number[] = [state.playhead, 0];

  for (const trackId of [VIDEO_TRACK_ID, AUDIO_TRACK_ID]) {
    const laidOut = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === trackId));
    for (const clip of laidOut) {
      targets.push(clip.timelineStart, clip.timelineStart + clip.duration);
    }
  }

  for (const overlay of state.project.overlays) {
    if (overlay.id === excludeOverlayId) continue;
    targets.push(overlay.start, overlay.end);
  }

  return targets;
}
