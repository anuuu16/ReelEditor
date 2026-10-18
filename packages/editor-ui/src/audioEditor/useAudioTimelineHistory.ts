import { useCallback, useRef, useState } from "react";
import type { AudioTimeline } from "./timeline.js";

const MAX_HISTORY = 60;
/** Consecutive commits with the same coalesce key within this window merge into one undo entry. */
export const COALESCE_WINDOW_MS = 1000;

interface History {
  timeline: AudioTimeline;
  /** Update state AND push one undo entry. With `coalesceKey`, a rapid run of commits carrying the
   * same key (a slider being dragged, a note being typed) collapses into a single entry: only the
   * first one pushes, the rest just update state — so one undo takes the whole run back, instead
   * of the user having to undo through every intermediate slider value/keystroke (which also used
   * to flush real edits out of the capped history). */
  commit: (next: AudioTimeline | ((prev: AudioTimeline) => AudioTimeline), coalesceKey?: string) => void;
  /** Push the current state onto the undo stack now — call once at the start of a drag gesture. */
  checkpoint: () => void;
  /** Update state without touching history — for the moves within a gesture that `checkpoint` opened. */
  live: (next: AudioTimeline | ((prev: AudioTimeline) => AudioTimeline)) => void;
  /** Replaces the whole timeline AND wipes undo/redo history — for restoring a persisted project
   * on load, which isn't something a user should be able to "undo" back out of. */
  load: (next: AudioTimeline) => void;
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
  const lastCommit = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);

  const live = useCallback<History["live"]>((next) => {
    setTimeline((prev) => (typeof next === "function" ? next(prev) : next));
  }, []);

  const checkpoint = useCallback(() => {
    lastCommit.current = null; // a drag gesture is its own undo unit — never merged into a prior run
    setTimeline((prev) => {
      past.current = [...past.current, prev].slice(-MAX_HISTORY);
      future.current = [];
      rerender();
      return prev;
    });
  }, []);

  const commit = useCallback<History["commit"]>((next, coalesceKey) => {
    setTimeline((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      if (resolved === prev) return prev;
      const now = Date.now();
      const merge =
        coalesceKey !== undefined &&
        lastCommit.current !== null &&
        lastCommit.current.key === coalesceKey &&
        now - lastCommit.current.at < COALESCE_WINDOW_MS &&
        past.current.length > 0;
      if (!merge) past.current = [...past.current, prev].slice(-MAX_HISTORY);
      future.current = [];
      lastCommit.current = coalesceKey !== undefined ? { key: coalesceKey, at: now } : null;
      rerender();
      return resolved;
    });
  }, []);

  const load = useCallback((next: AudioTimeline) => {
    past.current = [];
    future.current = [];
    lastCommit.current = null;
    rerender();
    setTimeline(next);
  }, []);

  const undo = useCallback(() => {
    lastCommit.current = null; // the next commit after an undo must push, never merge across it
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
    lastCommit.current = null;
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
    load,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
