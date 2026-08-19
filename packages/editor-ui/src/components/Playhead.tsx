import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { TRACK_LABEL_WIDTH } from "../constants.js";

interface PlayheadProps {
  pixelsPerSecond: number;
  totalDuration: number;
}

export function Playhead({ pixelsPerSecond, totalDuration }: PlayheadProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const draggingRef = useRef(false);

  function seekFromEvent(e: ReactPointerEvent<HTMLDivElement>) {
    const parent = e.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const x = e.clientX - rect.left - TRACK_LABEL_WIDTH;
    const time = Math.max(0, Math.min(x / pixelsPerSecond, totalDuration));
    dispatch({ type: "SET_PLAYHEAD", time });
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    dispatch({ type: "PAUSE" });
    seekFromEvent(e);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (draggingRef.current) seekFromEvent(e);
  }

  function handlePointerUp() {
    draggingRef.current = false;
  }

  const left = TRACK_LABEL_WIDTH + state.playhead * pixelsPerSecond;

  return (
    <div
      className="playhead"
      style={{ left }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="playhead-handle" />
      <div className="playhead-line" />
    </div>
  );
}
