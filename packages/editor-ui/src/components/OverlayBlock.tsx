import { useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Overlay } from "@reel-studio/shared-types";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { MIN_OVERLAY_DURATION_SECONDS } from "../state/reducer.js";

interface OverlayBlockProps {
  overlay: Overlay;
  pixelsPerSecond: number;
}

type DragMode = "move" | "left" | "right";

interface DragState {
  mode: DragMode;
  startClientX: number;
  startStart: number;
  startEnd: number;
}

export function OverlayBlock({ overlay, pixelsPerSecond }: OverlayBlockProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const isSelected = state.selectedOverlayId === overlay.id;
  const dragRef = useRef<DragState | null>(null);
  const imageSource =
    overlay.kind === "image" ? state.project.sources.find((s) => s.id === overlay.imageSourceId) : undefined;

  function handleSelect(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "SELECT_OVERLAY", overlayId: overlay.id });
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "REMOVE_OVERLAY", overlayId: overlay.id });
  }

  function handlePointerDown(mode: DragMode, e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, startClientX: e.clientX, startStart: overlay.start, startEnd: overlay.end };
    dispatch({ type: "SELECT_OVERLAY", overlayId: overlay.id });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const drag = dragRef.current;
    if (!drag) return;
    const deltaSeconds = (e.clientX - drag.startClientX) / pixelsPerSecond;

    if (drag.mode === "move") {
      const duration = drag.startEnd - drag.startStart;
      const nextStart = Math.max(0, drag.startStart + deltaSeconds);
      dispatch({ type: "UPDATE_OVERLAY", overlayId: overlay.id, patch: { start: nextStart, end: nextStart + duration } });
    } else if (drag.mode === "left") {
      const nextStart = Math.max(0, Math.min(drag.startStart + deltaSeconds, overlay.end - MIN_OVERLAY_DURATION_SECONDS));
      dispatch({ type: "UPDATE_OVERLAY", overlayId: overlay.id, patch: { start: nextStart } });
    } else {
      const nextEnd = Math.max(overlay.start + MIN_OVERLAY_DURATION_SECONDS, drag.startEnd + deltaSeconds);
      dispatch({ type: "UPDATE_OVERLAY", overlayId: overlay.id, patch: { end: nextEnd } });
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    dragRef.current = null;
  }

  return (
    <div
      className={`overlay-block${isSelected ? " selected" : ""}`}
      onClick={handleSelect}
      onPointerDown={(e) => handlePointerDown("move", e)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ left: overlay.start * pixelsPerSecond, width: Math.max((overlay.end - overlay.start) * pixelsPerSecond, 4) }}
    >
      {overlay.kind === "image" ? (
        <>
          {imageSource && <img className="overlay-block-thumb" src={imageSource.previewUrl} alt="" draggable={false} />}
          <span className="overlay-block-text">{imageSource?.name ?? "Logo"}</span>
        </>
      ) : (
        <span className="overlay-block-text">{overlay.content || "Title"}</span>
      )}
      <button type="button" className="clip-remove" draggable={false} onClick={handleRemove} title="Remove overlay">
        ×
      </button>
      <div
        className="clip-trim-handle clip-trim-handle-left"
        draggable={false}
        onPointerDown={(e) => handlePointerDown("left", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div
        className="clip-trim-handle clip-trim-handle-right"
        draggable={false}
        onPointerDown={(e) => handlePointerDown("right", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
