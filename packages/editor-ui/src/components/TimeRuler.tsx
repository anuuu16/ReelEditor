import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEditorDispatch } from "../state/EditorContext.js";

const NICE_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300];
const MIN_LABEL_GAP_PX = 40;

function computeStepSeconds(pixelsPerSecond: number): number {
  for (const step of NICE_STEPS_SECONDS) {
    if (step * pixelsPerSecond >= MIN_LABEL_GAP_PX) return step;
  }
  return NICE_STEPS_SECONDS[NICE_STEPS_SECONDS.length - 1];
}

function formatTick(seconds: number): string {
  return String(Math.round(seconds)).padStart(2, "0");
}

interface TimeRulerProps {
  pixelsPerSecond: number;
  durationSeconds: number;
}

export function TimeRuler({ pixelsPerSecond, durationSeconds }: TimeRulerProps) {
  const dispatch = useEditorDispatch();
  const draggingRef = useRef(false);
  const step = computeStepSeconds(pixelsPerSecond);
  const tickCount = Math.max(Math.ceil(durationSeconds / step) + 2, 4);
  const ticks = Array.from({ length: tickCount }, (_, i) => i * step);

  function seekFromEvent(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, Math.min(x / pixelsPerSecond, durationSeconds));
    dispatch({ type: "SET_PLAYHEAD", time });
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
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

  return (
    <div
      className="time-ruler"
      style={{ width: Math.max(durationSeconds * pixelsPerSecond, 600) }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {ticks.map((t) => (
        <div key={t} className="time-tick" style={{ left: t * pixelsPerSecond }}>
          <span>{formatTick(t)}</span>
        </div>
      ))}
    </div>
  );
}
