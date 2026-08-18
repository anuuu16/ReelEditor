import { useState, type DragEvent } from "react";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { PIXELS_PER_SECOND } from "../constants.js";
import { ClipBlock } from "./ClipBlock.js";

interface TrackRowProps {
  trackId: string;
  label: string;
  accept: "video" | "audio";
}

export function TrackRow({ trackId, label, accept }: TrackRowProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isDragOver, setIsDragOver] = useState(false);
  const clips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === trackId));

  function indexFromDropX(clientX: number, laneEl: HTMLDivElement): number {
    const rect = laneEl.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    for (let i = 0; i < clips.length; i++) {
      const clipLeft = clips[i].timelineStart * PIXELS_PER_SECOND;
      const clipMid = clipLeft + (clips[i].duration * PIXELS_PER_SECOND) / 2;
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
      if (movingSource && movingSource.kind === accept) {
        dispatch({ type: "MOVE_CLIP", clipId, trackId, atIndex });
      }
    } else if (sourceId) {
      const source = state.project.sources.find((s) => s.id === sourceId);
      if (source && source.kind === accept) {
        dispatch({ type: "ADD_CLIP", trackId, sourceId, atIndex });
      }
    }
  }

  return (
    <div className="track-row">
      <div className="track-label">{label}</div>
      <div
        className={`track-lane${isDragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => dispatch({ type: "SELECT_CLIP", clipId: null })}
      >
        {clips.map((clip) => (
          <ClipBlock key={clip.id} clip={clip} />
        ))}
      </div>
    </div>
  );
}
