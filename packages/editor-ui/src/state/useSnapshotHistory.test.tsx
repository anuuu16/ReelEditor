import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSnapshotHistory } from "./useSnapshotHistory.js";

interface Doc {
  n: number;
  label: string;
}

const initial: Doc = { n: 0, label: "" };
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe("useSnapshotHistory", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("commits push undo entries; undo/redo walk them", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    act(() => result.current.commit((d) => ({ ...d, n: 1 })));
    act(() => result.current.commit((d) => ({ ...d, n: 2 })));
    expect(result.current.state.n).toBe(2);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.undo());
    expect(result.current.state.n).toBe(1);
    act(() => result.current.undo());
    expect(result.current.state.n).toBe(0);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    act(() => result.current.redo());
    expect(result.current.state.n).toBe(2);
    expect(result.current.canRedo).toBe(false);
  });

  it("a new commit after undo discards the redo branch", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    act(() => result.current.commit((d) => ({ ...d, n: 1 })));
    act(() => result.current.undo());
    act(() => result.current.commit((d) => ({ ...d, n: 5 })));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.state.n).toBe(0);
  });

  it("ignores commits that return the same object", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    act(() => result.current.commit((d) => d));
    expect(result.current.canUndo).toBe(false);
  });

  it("coalesces rapid same-key commits (a slider drag, a typing burst) into one undo step", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    for (let i = 1; i <= 10; i++) {
      act(() => result.current.commit((d) => ({ ...d, n: i }), "slider"));
      vi.advanceTimersByTime(100);
    }
    expect(result.current.state.n).toBe(10);
    act(() => result.current.undo());
    expect(result.current.state.n).toBe(0);
  });

  it("starts a new step when the key changes or the window lapses", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    act(() => result.current.commit((d) => ({ ...d, n: 1 }), "a"));
    act(() => result.current.commit((d) => ({ ...d, label: "x" }), "b"));
    vi.advanceTimersByTime(2000);
    act(() => result.current.commit((d) => ({ ...d, label: "xy" }), "b"));
    act(() => result.current.undo());
    expect(result.current.state).toEqual({ n: 1, label: "x" });
    act(() => result.current.undo());
    expect(result.current.state).toEqual({ n: 1, label: "" });
    act(() => result.current.undo());
    expect(result.current.state).toEqual(initial);
  });

  it("keeps coalescing for as long as a pointer button is held, however slow the drag", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    act(() => result.current.commit((d) => ({ ...d, n: 1 }), "drag"));
    vi.advanceTimersByTime(5000);
    act(() => result.current.commit((d) => ({ ...d, n: 2 }), "drag"));
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    act(() => result.current.undo());
    expect(result.current.state.n).toBe(0);
  });

  it("checkpoint + live = one undo step for a whole gesture", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    act(() => result.current.checkpoint());
    for (let i = 1; i <= 20; i++) act(() => result.current.live((d) => ({ ...d, n: i })));
    expect(result.current.state.n).toBe(20);
    act(() => result.current.undo());
    expect(result.current.state.n).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("load replaces the state and wipes history", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial));
    act(() => result.current.commit((d) => ({ ...d, n: 1 })));
    act(() => result.current.load({ n: 42, label: "restored" }));
    expect(result.current.state.n).toBe(42);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("caps the undo stack at the configured depth", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial, 3));
    for (let i = 1; i <= 6; i++) act(() => result.current.commit((d) => ({ ...d, n: i })));
    let undos = 0;
    while (result.current.canUndo) {
      act(() => result.current.undo());
      undos++;
    }
    expect(undos).toBe(3);
    expect(result.current.state.n).toBe(3);
  });

  // Regression: React StrictMode double-invokes updater functions in development. An earlier
  // version kept the stacks in refs and mutated them inside the updater, which pushed twice per
  // commit/checkpoint but only once for coalesced commits — so undo skipped or repeated steps.
  it("behaves identically under StrictMode (no double push/pop)", () => {
    const { result } = renderHook(() => useSnapshotHistory(initial), { wrapper: strict });
    act(() => result.current.commit((d) => ({ ...d, n: 1 })));
    act(() => result.current.checkpoint());
    act(() => result.current.live((d) => ({ ...d, n: 2 })));
    act(() => result.current.commit((d) => ({ ...d, label: "a" }), "k"));
    vi.advanceTimersByTime(2000);
    act(() => result.current.commit((d) => ({ ...d, label: "ab" }), "k"));

    const seen: Doc[] = [result.current.state];
    while (result.current.canUndo) {
      act(() => result.current.undo());
      seen.push(result.current.state);
    }
    expect(seen).toEqual([
      { n: 2, label: "ab" },
      { n: 2, label: "a" },
      { n: 2, label: "" },
      { n: 1, label: "" },
      { n: 0, label: "" },
    ]);
  });
});
