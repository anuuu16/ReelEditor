import { useSnapshotHistory, type SnapshotHistory } from "../state/useSnapshotHistory.js";
import type { AudioTimeline } from "./timeline.js";

const MAX_HISTORY = 60;
/** Consecutive commits with the same coalesce key within this window merge into one undo entry. */
export const COALESCE_WINDOW_MS = 1000;

interface History extends Omit<SnapshotHistory<AudioTimeline>, "state"> {
  timeline: AudioTimeline;
}

// In-memory undo/redo over whole-timeline snapshots. Clips are plain objects and AudioBuffers are
// shared by reference, so a snapshot is cheap. A drag = one `checkpoint()` on pointer-down then
// `live()` for every move, so the whole gesture collapses to a single undo step.
export function useAudioTimelineHistory(initial: AudioTimeline): History {
  const { state, ...rest } = useSnapshotHistory(initial, MAX_HISTORY);
  return { timeline: state, ...rest };
}
