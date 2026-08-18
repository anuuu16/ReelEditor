import { useState, type DragEvent } from "react";
import type { MediaSource } from "@reel-studio/shared-types";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { readMediaMetadata } from "../media/importFile.js";

export function MediaLibrary() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) continue;
      try {
        const source = await readMediaMetadata(file);
        dispatch({ type: "ADD_SOURCE", source });
      } catch (err) {
        console.error(err);
      }
    }
  }

  function handleAppend(source: MediaSource) {
    const trackId = source.kind === "video" ? VIDEO_TRACK_ID : AUDIO_TRACK_ID;
    const clipsOnTrack = state.project.clips.filter((c) => c.trackId === trackId);
    dispatch({ type: "ADD_CLIP", trackId, sourceId: source.id, atIndex: clipsOnTrack.length });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={`media-library${isDraggingOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <h2>Media</h2>
      <label className="import-button">
        Import files
        <input type="file" accept="video/*,audio/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      </label>
      {state.project.sources.length === 0 && <p className="hint">Drop video/audio files here, or use Import.</p>}
      <ul className="media-list">
        {state.project.sources.map((source) => (
          <li
            key={source.id}
            className="media-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-source-id", source.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <span className={`media-kind media-kind-${source.kind}`}>{source.kind === "video" ? "VID" : "AUD"}</span>
            <span className="media-name">{source.name}</span>
            <button type="button" onClick={() => handleAppend(source)} title="Add to timeline">
              +
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
