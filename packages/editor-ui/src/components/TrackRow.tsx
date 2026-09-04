import { useState, type DragEvent } from "react";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { trackKindAccepts } from "../media/trackAccepts.js";
import { ClipBlock } from "./ClipBlock.js";

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

  // Below this pixel distance from where a clip would naturally land (zero gap) at its target
  // index, treat the drop as "no gap intended" — otherwise every reorder-only drop would need
  // pixel-perfect precision to avoid leaving a tiny unwanted gap.
  const GAP_SNAP_PX = 8;

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const clipId = e.dataTransfer.getData("application/x-clip-id");
    const sourceId = e.dataTransfer.getData("application/x-source-id");
    const rect = e.currentTarget.getBoundingClientRect();

    if (clipId) {
      const movingClip = state.project.clips.find((c) => c.id === clipId);
      const movingSource = movingClip && state.project.sources.find((s) => s.id === movingClip.sourceId);
      if (movingClip && movingSource && trackKindAccepts(accept, movingSource.kind)) {
        // Place the clip's *left edge* where the user dropped it — subtract how far into the clip
        // they grabbed, so a mid-clip grab doesn't jump the clip's start to the cursor.
        const grabOffsetPx = Number(e.dataTransfer.getData("application/x-clip-grab-offset")) || 0;
        const clipLeftSeconds = Math.max(0, (e.clientX - rect.left - grabOffsetPx) / pixelsPerSecond);

        // Insertion index among the *other* clips (the moving one already removed): it goes after
        // every clip whose midpoint the drop cleared. This is the final index the reducer inserts
        // at — no off-by-one, and no snapping to "right after the previous clip".
        const otherClips = state.project.clips.filter((c) => c.trackId === trackId && c.id !== clipId);
        const otherLaidOut = layoutSequentialClips(otherClips);
        let targetIndex = 0;
        for (const c of otherLaidOut) {
          if (clipLeftSeconds >= c.timelineStart + c.duration / 2) targetIndex++;
          else break;
        }

        // Where the clip would sit with no gap at that index; anything past that becomes empty space
        // before it (snapped away if it's only a pixel or two).
        const hypothetical = [...otherClips];
        hypothetical.splice(targetIndex, 0, { ...movingClip, gapBeforeSeconds: 0 });
        const naturalStart = layoutSequentialClips(hypothetical)[targetIndex]?.timelineStart ?? 0;
        const rawGap = Math.max(0, clipLeftSeconds - naturalStart);
        const gapBeforeSeconds = rawGap * pixelsPerSecond < GAP_SNAP_PX ? 0 : rawGap;
        dispatch({ type: "MOVE_CLIP", clipId, trackId, atIndex: targetIndex, gapBeforeSeconds });
      }
    } else if (sourceId) {
      const source = state.project.sources.find((s) => s.id === sourceId);
      if (source && trackKindAccepts(accept, source.kind)) {
        dispatch({ type: "ADD_CLIP", trackId, sourceId, atIndex: indexFromDropX(e.clientX, e.currentTarget) });
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
            setAddMenuSide(addMenuSide === "start" ? null : "start");
          }}
        >
          +
        </button>
        {addMenuSide === "start" && (
          <div className="track-add-menu" style={{ left: 0 }} onClick={(e) => e.stopPropagation()}>
            {candidateSources.length === 0 && <span className="hint">Import {accept} first</span>}
            {candidateSources.map((s) => (
              <button key={s.id} type="button" onClick={() => handleAddClip(s.id, 0)}>
                {s.name}
              </button>
            ))}
          </div>
        )}

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
              setAddMenuSide(addMenuSide === "end" ? null : "end");
            }}
          >
            +
          </button>
        )}
        {addMenuSide === "end" && (
          <div className="track-add-menu" style={{ left: endX }} onClick={(e) => e.stopPropagation()}>
            {candidateSources.length === 0 && <span className="hint">Import {accept} first</span>}
            {candidateSources.map((s) => (
              <button key={s.id} type="button" onClick={() => handleAddClip(s.id, clips.length)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
