import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_MAX_HISTORY = 60;
/** Edits that share a coalesce key and land within this window collapse into one undo step. */
const COALESCE_WINDOW_MS = 1200;

type Updater<T> = T | ((prev: T) => T);

export interface SnapshotHistory<T> {
  state: T;
  /**
   * Update state AND push one undo entry. Pass a `coalesceKey` (e.g. "brightness", or a text
   * field's id) for rapid-fire edits of the same control — a slider drag, a typing burst — so
   * they collapse into a single undo step instead of one per input event. Coalescing also stays
   * open for as long as a pointer button is held, so a slow slider drag is still one step.
   */
  commit: (next: Updater<T>, coalesceKey?: string) => void;
  /** Push the current state onto the undo stack now — call once at the start of a drag gesture. */
  checkpoint: () => void;
  /** Update state without touching history — for the moves within a gesture that `checkpoint` opened. */
  live: (next: Updater<T>) => void;
  /** Replaces the whole state AND wipes undo/redo history — for restoring a persisted document on
   * load, which isn't something a user should be able to "undo" back out of. */
  load: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface HistoryState<T> {
  present: T;
  past: T[];
  future: T[];
  /** The last keyed commit, for coalescing. */
  last: { key: string; at: number } | null;
}

function resolve<T>(next: Updater<T>, prev: T): T {
  return typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
}

// In-memory undo/redo over whole-state snapshots. Works for any immutable, cheaply-shareable state
// (plain objects whose unchanged branches are reused), so a snapshot is just a reference.
//
// The stacks live INSIDE the React state and every transition is a pure function of the previous
// history — never a side effect in an updater. That matters: React StrictMode double-invokes
// updaters in development, and bookkeeping done as a side effect there pushes/pops twice.
export function useSnapshotHistory<T>(initial: T, maxHistory = DEFAULT_MAX_HISTORY): SnapshotHistory<T> {
  const [history, setHistory] = useState<HistoryState<T>>(() => ({ present: initial, past: [], future: [], last: null }));
  const pointerDown = useRef(false);

  useEffect(() => {
    const down = () => {
      pointerDown.current = true;
    };
    const up = () => {
      pointerDown.current = false;
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
  }, []);

  const live = useCallback<SnapshotHistory<T>["live"]>((next) => {
    setHistory((h) => {
      const present = resolve(next, h.present);
      return present === h.present ? h : { ...h, present };
    });
  }, []);

  const checkpoint = useCallback(() => {
    setHistory((h) => ({ ...h, past: [...h.past, h.present].slice(-maxHistory), future: [], last: null }));
  }, [maxHistory]);

  const commit = useCallback<SnapshotHistory<T>["commit"]>(
    (next, coalesceKey) => {
      setHistory((h) => {
        const present = resolve(next, h.present);
        if (present === h.present) return h;
        const now = Date.now();
        const coalesce =
          coalesceKey !== undefined &&
          h.last !== null &&
          h.last.key === coalesceKey &&
          (pointerDown.current || now - h.last.at < COALESCE_WINDOW_MS);
        return {
          present,
          past: coalesce ? h.past : [...h.past, h.present].slice(-maxHistory),
          future: coalesce ? h.future : [],
          last: coalesceKey === undefined ? null : { key: coalesceKey, at: now },
        };
      });
    },
    [maxHistory],
  );

  const load = useCallback((next: T) => {
    setHistory({ present: next, past: [], future: [], last: null });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      return { present: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.present, ...h.future], last: null };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      return { present: h.future[0], past: [...h.past, h.present], future: h.future.slice(1), last: null };
    });
  }, []);

  return useMemo(
    () => ({
      state: history.present,
      commit,
      checkpoint,
      live,
      load,
      undo,
      redo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
    }),
    [history, commit, checkpoint, live, load, undo, redo],
  );
}
