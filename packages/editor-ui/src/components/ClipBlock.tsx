import { useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { LaidOutClip } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { MIN_CLIP_DURATION_SECONDS } from "../state/reducer.js";
import { ClipThumbnailStrip } from "./ClipThumbnailStrip.js";
import { ClipWaveform } from "./ClipWaveform.js";

interface ClipBlockProps {
  clip: LaidOutClip;
  index: number;
  pixelsPerSecond: number;
}

interface TrimDragState {
  edge: "left" | "right";
  startClientX: number;
  /** The clip's displayed (timeline) duration when the drag began, seconds. */
  startDuration: number;
}

export function ClipBlock({ clip, index, pixelsPerSecond }: ClipBlockProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const source = state.project.sources.find((s) => s.id === clip.sourceId);
  const isSelected = state.selectedClipId === clip.id;
  const widthPx = Math.max(clip.duration * pixelsPerSecond, 4);
  const trimDragRef = useRef<TrimDragState | null>(null);
  const [isTrimming, setIsTrimming] = useState(false);

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    // A press on a trim handle (a child of this draggable block) would otherwise also kick off the
    // native move-drag, which cancels the pointer events the resize relies on — and then the drop
    // gets read as "move this clip". Refuse the drag while a trim is in progress.
    if (trimDragRef.current) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("application/x-clip-id", clip.id);
    // How far into the clip (in px) the user grabbed, so the drop can place the clip's left edge
    // where they expect instead of snapping the clip's start to the cursor.
    e.dataTransfer.setData("application/x-clip-grab-offset", String(e.clientX - e.currentTarget.getBoundingClientRect().left));
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

  function handleTrimPointerDown(edge: "left" | "right", e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    trimDragRef.current = { edge, startClientX: e.clientX, startDuration: clip.duration };
    setIsTrimming(true);
  }

  // Dragging a handle past the clip's available source footage no longer just stops there — it
  // keeps extending the clip and slows playback down just enough to stretch the footage across the
  // longer duration (an 8s clip dragged out to 16s plays at 0.5×), the same "extend footage first,
  // then nudge speed" trade the transition-overlap compensation (BULK_SET_TRANSITION in reducer.ts)
  // already makes. Reference speed 1 (not clip.speed) as the baseline, so the split between footage
  // and speed is a pure function of (inPoint/outPoint, targetDuration, source length) — dragging
  // back within bounds cleanly recovers speed 1 rather than drifting from whatever speed a previous
  // drag left behind.
  function handleTrimPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const drag = trimDragRef.current;
    if (!drag || !source) return;
    const deltaSeconds = (e.clientX - drag.startClientX) / pixelsPerSecond;

    if (drag.edge === "left") {
      const targetDuration = Math.max(MIN_CLIP_DURATION_SECONDS, drag.startDuration - deltaSeconds);
      const inPoint = Math.max(0, Math.min(clip.outPoint - MIN_CLIP_DURATION_SECONDS, clip.outPoint - targetDuration));
      const speed = (clip.outPoint - inPoint) / targetDuration;
      dispatch({ type: "UPDATE_CLIP", clipId: clip.id, patch: { inPoint, speed } });
    } else {
      const targetDuration = Math.max(MIN_CLIP_DURATION_SECONDS, drag.startDuration + deltaSeconds);
      const outPoint = Math.max(clip.inPoint + MIN_CLIP_DURATION_SECONDS, Math.min(source.durationSeconds, clip.inPoint + targetDuration));
      const speed = (outPoint - clip.inPoint) / targetDuration;
      dispatch({ type: "UPDATE_CLIP", clipId: clip.id, patch: { outPoint, speed } });
    }
  }

  function handleTrimPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    trimDragRef.current = null;
    setIsTrimming(false);
  }

  return (
    <div
      className={`clip-block${isSelected ? " selected" : ""}`}
      draggable={!isTrimming}
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
      {source?.kind === "image" && !source.isPlaceholder && (
        <div className="clip-image-fill">
          <img src={source.previewUrl} draggable={false} alt="" />
        </div>
      )}
      {source?.kind === "image" && source.isPlaceholder && (
        <div className="clip-thumbnails clip-thumbnails-placeholder">
          <span>+ Add your footage</span>
        </div>
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
        <span className="clip-name">
          {index + 1}. {clip.label || source?.name || "clip"}
        </span>
        {Math.abs(clip.speed - 1) > 0.005 && (
          <span className="clip-speed-badge" title="Playback speed, from dragging a trim handle past the clip's available footage">
            {clip.speed.toFixed(2)}×
          </span>
        )}
        <button type="button" className="clip-remove" draggable={false} onClick={handleRemove} title="Remove clip">
          ×
        </button>
      </div>
      <div
        className="clip-trim-handle clip-trim-handle-left"
        draggable={false}
        onPointerDown={(e) => handleTrimPointerDown("left", e)}
        onPointerMove={handleTrimPointerMove}
        onPointerUp={handleTrimPointerUp}
        onPointerCancel={handleTrimPointerUp}
      />
      <div
        className="clip-trim-handle clip-trim-handle-right"
        draggable={false}
        onPointerDown={(e) => handleTrimPointerDown("right", e)}
        onPointerMove={handleTrimPointerMove}
        onPointerUp={handleTrimPointerUp}
        onPointerCancel={handleTrimPointerUp}
      />
    </div>
  );
}
