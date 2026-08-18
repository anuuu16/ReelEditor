import type { DragEvent, MouseEvent } from "react";
import type { LaidOutClip } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { PIXELS_PER_SECOND } from "../constants.js";

export function ClipBlock({ clip }: { clip: LaidOutClip }) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const source = state.project.sources.find((s) => s.id === clip.sourceId);

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData("application/x-clip-id", clip.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "REMOVE_CLIP", clipId: clip.id });
  }

  return (
    <div
      className="clip-block"
      draggable
      onDragStart={handleDragStart}
      style={{ left: clip.timelineStart * PIXELS_PER_SECOND, width: Math.max(clip.duration * PIXELS_PER_SECOND, 4) }}
    >
      <span className="clip-name">{source?.name ?? "clip"}</span>
      <button type="button" className="clip-remove" onClick={handleRemove} title="Remove clip">
        ×
      </button>
    </div>
  );
}
