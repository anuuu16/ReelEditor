import type { DragEvent, MouseEvent } from "react";
import type { LaidOutClip } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { ClipThumbnailStrip } from "./ClipThumbnailStrip.js";
import { ClipWaveform } from "./ClipWaveform.js";

interface ClipBlockProps {
  clip: LaidOutClip;
  pixelsPerSecond: number;
}

export function ClipBlock({ clip, pixelsPerSecond }: ClipBlockProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const source = state.project.sources.find((s) => s.id === clip.sourceId);
  const isSelected = state.selectedClipId === clip.id;
  const widthPx = Math.max(clip.duration * pixelsPerSecond, 4);

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData("application/x-clip-id", clip.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "REMOVE_CLIP", clipId: clip.id });
  }

  function handleSelect(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "SELECT_CLIP", clipId: clip.id });
  }

  function handleToggleMute(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "UPDATE_CLIP", clipId: clip.id, patch: { muted: !clip.muted } });
  }

  return (
    <div
      className={`clip-block${isSelected ? " selected" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onClick={handleSelect}
      style={{ left: clip.timelineStart * pixelsPerSecond, width: widthPx }}
    >
      {source?.kind === "video" && (
        <ClipThumbnailStrip source={source} inPoint={clip.inPoint} outPoint={clip.outPoint} widthPx={widthPx} />
      )}
      {source?.kind === "audio" && (
        <ClipWaveform source={source} inPoint={clip.inPoint} outPoint={clip.outPoint} widthPx={widthPx} />
      )}
      <div className="clip-overlay">
        <button
          type="button"
          className={`clip-mute-toggle${clip.muted ? " muted" : ""}`}
          draggable={false}
          onClick={handleToggleMute}
          title={clip.muted ? "Unmute" : "Mute"}
        >
          {clip.muted ? "Muted" : "Mute"}
        </button>
        <span className="clip-name">{clip.label || source?.name || "clip"}</span>
        <button type="button" className="clip-remove" draggable={false} onClick={handleRemove} title="Remove clip">
          ×
        </button>
      </div>
    </div>
  );
}
