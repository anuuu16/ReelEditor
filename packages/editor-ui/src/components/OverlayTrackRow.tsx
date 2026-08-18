import { useState, type DragEvent } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { OVERLAY_TRACK_ID } from "../state/initialProject.js";
import { OverlayBlock } from "./OverlayBlock.js";

const DEFAULT_LOGO_DURATION_SECONDS = 5;

interface OverlayTrackRowProps {
  pixelsPerSecond: number;
}

export function OverlayTrackRow({ pixelsPerSecond }: OverlayTrackRowProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isDragOver, setIsDragOver] = useState(false);
  const overlays = state.project.overlays.filter((o) => o.trackId === OVERLAY_TRACK_ID);
  const laneWidth = overlays.reduce((end, o) => Math.max(end, o.end), 0) * pixelsPerSecond;

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const sourceId = e.dataTransfer.getData("application/x-source-id");
    if (!sourceId) return;
    const source = state.project.sources.find((s) => s.id === sourceId);
    if (!source || source.kind !== "image") return;

    const rect = e.currentTarget.getBoundingClientRect();
    const start = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
    dispatch({
      type: "ADD_IMAGE_OVERLAY",
      trackId: OVERLAY_TRACK_ID,
      sourceId,
      start,
      end: start + DEFAULT_LOGO_DURATION_SECONDS,
    });
  }

  return (
    <div className="track-row">
      <div className="track-label">Overlays</div>
      <div
        className={`track-lane track-lane-overlay${isDragOver ? " drag-over" : ""}`}
        style={{ width: Math.max(laneWidth, 600) }}
        onClick={() => dispatch({ type: "SELECT_OVERLAY", overlayId: null })}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {overlays.map((overlay) => (
          <OverlayBlock key={overlay.id} overlay={overlay} pixelsPerSecond={pixelsPerSecond} />
        ))}
      </div>
    </div>
  );
}
