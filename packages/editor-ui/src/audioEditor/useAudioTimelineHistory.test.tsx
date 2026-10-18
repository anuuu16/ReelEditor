// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COALESCE_WINDOW_MS, useAudioTimelineHistory } from "./useAudioTimelineHistory.js";
import { DEFAULT_DUCKING, DEFAULT_LANE_COUNT, type AudioTimeline } from "./timeline.js";
import { makeClipFixture } from "./test-fixtures.js";

const EMPTY: AudioTimeline = { sources: [], clips: [], notes: [], laneCount: DEFAULT_LANE_COUNT, ducking: DEFAULT_DUCKING };

function setup() {
  return renderHook(() => useAudioTimelineHistory(EMPTY));
}

function withGain(gainDb: number): AudioTimeline {
  return { ...EMPTY, clips: [makeClipFixture({ gainDb })] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAudioTimelineHistory coalescing", () => {
  it("a rapid run of commits with the same key is ONE undo entry", () => {
    const { result } = setup();
    // Simulates dragging the Gain slider: a commit per tick, all with the same key.
    for (const g of [1, 2, 3, 4, 5]) {
      act(() => result.current.commit(withGain(g), "clip:c1:gainDb"));
      vi.advanceTimersByTime(50);
    }
    expect(result.current.timeline.clips[0].gainDb).toBe(5);
    act(() => result.current.undo());
    // One undo: all five ticks revert together, back to the pre-drag state.
    expect(result.current.timeline).toEqual(EMPTY);
    expect(result.current.canUndo).toBe(false);
  });

  it("redo after a coalesced run restores the final value, not an intermediate one", () => {
    const { result } = setup();
    for (const g of [1, 2, 3]) act(() => result.current.commit(withGain(g), "k"));
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(result.current.timeline.clips[0].gainDb).toBe(3);
  });

  it("different keys do not merge", () => {
    const { result } = setup();
    act(() => result.current.commit(withGain(1), "clip:c1:gainDb"));
    act(() => result.current.commit({ ...withGain(1), laneCount: 5 }, "laneCount"));
    act(() => result.current.undo());
    expect(result.current.timeline.laneCount).toBe(DEFAULT_LANE_COUNT);
    expect(result.current.timeline.clips[0].gainDb).toBe(1);
    act(() => result.current.undo());
    expect(result.current.timeline).toEqual(EMPTY);
  });

  it("the same key after a pause starts a new undo entry", () => {
    const { result } = setup();
    act(() => result.current.commit(withGain(1), "k"));
    vi.advanceTimersByTime(COALESCE_WINDOW_MS + 1);
    act(() => result.current.commit(withGain(2), "k"));
    act(() => result.current.undo());
    expect(result.current.timeline.clips[0].gainDb).toBe(1);
    act(() => result.current.undo());
    expect(result.current.timeline).toEqual(EMPTY);
  });

  it("a commit without a key never merges, even right after a keyed one", () => {
    const { result } = setup();
    act(() => result.current.commit(withGain(1), "k"));
    act(() => result.current.commit(withGain(2)));
    act(() => result.current.undo());
    expect(result.current.timeline.clips[0].gainDb).toBe(1);
  });

  it("undo breaks a coalescing run — the next commit pushes instead of merging across it", () => {
    const { result } = setup();
    act(() => result.current.commit(withGain(1), "k"));
    act(() => result.current.undo());
    act(() => result.current.commit(withGain(9), "k"));
    act(() => result.current.undo());
    expect(result.current.timeline).toEqual(EMPTY);
  });

  it("a drag gesture (checkpoint + live) is still one undo step and breaks coalescing", () => {
    const { result } = setup();
    act(() => result.current.commit(withGain(1), "k"));
    act(() => result.current.checkpoint());
    act(() => result.current.live(withGain(5)));
    act(() => result.current.live(withGain(7)));
    act(() => result.current.commit(withGain(8), "k")); // must NOT merge into the pre-gesture run
    act(() => result.current.undo());
    expect(result.current.timeline.clips[0].gainDb).toBe(7);
    act(() => result.current.undo());
    expect(result.current.timeline.clips[0].gainDb).toBe(1);
    act(() => result.current.undo());
    expect(result.current.timeline).toEqual(EMPTY);
  });

  it("redo stack is cleared by a coalesced commit like any other edit", () => {
    const { result } = setup();
    act(() => result.current.commit(withGain(1)));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commit(withGain(2), "k"));
    expect(result.current.canRedo).toBe(false);
  });
});
