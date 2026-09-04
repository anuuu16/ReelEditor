import { useCallback, useRef, useState } from "react";
import type { AudioTimeline } from "./timeline.js";

const MAX_HISTORY = 60;

interface History {
  timeline: AudioTimeline;
  /** Update state AND push one undo entry. */
  commit: (next: AudioTimeline | ((prev: AudioTimeline) => AudioTimeline)) => void;
  /** Push the current state onto the undo stack now — call once at the start of a drag gesture. */
  checkpoint: () => void;
  /** Update state without touching history — for the moves within a gesture that `checkpoint` opened. */
  live: (next: AudioTimeline | ((prev: AudioTimeline) => AudioTimeline)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// In-memory undo/redo over whole-timeline snapshots. Clips are plain objects and AudioBuffers are
// shared by reference, so a snapshot is cheap. A drag = one `checkpoint()` on pointer-down then
// `live()` for every move, so the whole gesture collapses to a single undo step.
export function useAudioTimelineHistory(initial: AudioTimeline): History {
  const [timeline, setTimeline] = useState(initial);
  const past = useRef<AudioTimeline[]>([]);
  const future = useRef<AudioTimeline[]>([]);
  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);

  const live = useCallback<History["live"]>((next) => {
    setTimeline((prev) => (typeof next === "function" ? next(prev) : next));
  }, []);

  const checkpoint = useCallback(() => {
    setTimeline((prev) => {
      past.current = [...past.current, prev].slice(-MAX_HISTORY);
      future.current = [];
      rerender();
      return prev;
    });
  }, []);

  const commit = useCallback<History["commit"]>((next) => {
    setTimeline((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      if (resolved === prev) return prev;
      past.current = [...past.current, prev].slice(-MAX_HISTORY);
      future.current = [];
      rerender();
      return resolved;
    });
  }, []);

  const undo = useCallback(() => {
    setTimeline((prev) => {
      if (past.current.length === 0) return prev;
      const previous = past.current[past.current.length - 1];
      past.current = past.current.slice(0, -1);
      future.current = [prev, ...future.current];
      rerender();
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setTimeline((prev) => {
      if (future.current.length === 0) return prev;
      const next = future.current[0];
      future.current = future.current.slice(1);
      past.current = [...past.current, prev];
      rerender();
      return next;
    });
  }, []);

  return {
    timeline,
    commit,
    checkpoint,
    live,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
