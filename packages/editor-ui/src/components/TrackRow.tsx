import { useState, type DragEvent } from "react";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { trackKindAccepts } from "../media/trackAccepts.js";
import { ClipBlock } from "./ClipBlock.js";
import { MediaPickerModal } from "./MediaPickerModal.js";

interface TrackRowProps {
  trackId: string;
  label: string;
  accept: "video" | "audio";
  pixelsPerSecond: number;
  isActive?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
}

export function TrackRow({ trackId, label, accept, pixelsPerSecond, isActive, onSelect, onRemove }: TrackRowProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isDragOver, setIsDragOver] = useState(false);
  const [addMenuSide, setAddMenuSide] = useState<"start" | "end" | null>(null);
  const clips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === trackId));
  const candidateSources = state.project.sources.filter((s) => !s.isPlaceholder && trackKindAccepts(accept, s.kind));
  const endX = clips.reduce((end, c) => Math.max(end, c.timelineStart + c.duration), 0) * pixelsPerSecond;

  function handleAddClip(sourceId: string, atIndex: number) {
    dispatch({ type: "ADD_CLIP", trackId, sourceId, atIndex });
    setAddMenuSide(null);
  }

  function indexFromDropX(clientX: number, laneEl: HTMLDivElement): number {
    const rect = laneEl.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    for (let i = 0; i < clips.length; i++) {
      const clipLeft = clips[i].timelineStart * pixelsPerSecond;
      const clipMid = clipLeft + (clips[i].duration * pixelsPerSecond) / 2;
      if (relativeX < clipMid) return i;
    }
    return clips.length;
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const clipId = e.dataTransfer.getData("application/x-clip-id");
    const sourceId = e.dataTransfer.getData("application/x-source-id");
    const atIndex = indexFromDropX(e.clientX, e.currentTarget);

    if (clipId) {
      const movingClip = state.project.clips.find((c) => c.id === clipId);
      const movingSource = movingClip && state.project.sources.find((s) => s.id === movingClip.sourceId);
      if (movingSource && trackKindAccepts(accept, movingSource.kind)) {
        dispatch({ type: "MOVE_CLIP", clipId, trackId, atIndex });
      }
    } else if (sourceId) {
      const source = state.project.sources.find((s) => s.id === sourceId);
      if (source && trackKindAccepts(accept, source.kind)) {
        dispatch({ type: "ADD_CLIP", trackId, sourceId, atIndex });
      }
    }
  }

  return (
    <div className="track-row">
      <div
        className={`track-label${onSelect ? " track-label-selectable" : ""}${isActive ? " active" : ""}`}
        onClick={onSelect}
        title={onSelect ? "Click to make this the destination for newly added audio" : undefined}
      >
        <span>{label}</span>
        {onRemove && (
          <button
            type="button"
            className="track-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove track"
          >
            ×
          </button>
        )}
      </div>
      <div
        className={`track-lane track-lane-${accept}${isDragOver ? " drag-over" : ""}`}
        style={{ width: Math.max(clips.reduce((end, c) => Math.max(end, c.timelineStart + c.duration), 0) * pixelsPerSecond, 600) }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          dispatch({ type: "SELECT_CLIP", clipId: null });
          onSelect?.();
          setAddMenuSide(null);
        }}
      >
        <button
          type="button"
          className="track-add-clip track-add-clip-start"
          title={`Add a ${accept} clip at the start`}
          onClick={(e) => {
            e.stopPropagation();
            setAddMenuSide("start");
          }}
        >
          +
        </button>

        {clips.map((clip, i) => (
          <ClipBlock key={clip.id} clip={clip} index={i} pixelsPerSecond={pixelsPerSecond} />
        ))}

        {clips.length > 0 && (
          <button
            type="button"
            className="track-add-clip track-add-clip-end"
            style={{ left: endX }}
            title={`Add a ${accept} clip at the end`}
            onClick={(e) => {
              e.stopPropagation();
              setAddMenuSide("end");
            }}
          >
            +
          </button>
        )}
      </div>
      {addMenuSide && (
        <MediaPickerModal
          title={`Add a ${accept} clip at the ${addMenuSide}`}
          candidates={candidateSources}
          onChoose={(sourceId) => handleAddClip(sourceId, addMenuSide === "start" ? 0 : clips.length)}
          onClose={() => setAddMenuSide(null)}
        />
      )}
    </div>
  );
}
