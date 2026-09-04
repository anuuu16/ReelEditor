import { useState, type DragEvent } from "react";
import type { MediaSource } from "@reel-studio/shared-types";
import { getTracksByKind } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { OVERLAY_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { readMediaMetadata } from "../media/importFile.js";
import { deleteMediaBlob, saveMediaBlob } from "../persistence/db.js";
import { SlideshowDialog } from "./SlideshowDialog.js";

const DEFAULT_LOGO_DURATION_SECONDS = 5;

const MEDIA_KIND_LABEL: Record<MediaSource["kind"], string> = { video: "VID", audio: "AUD", image: "IMG" };

export function MediaLibrary() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [overlayMenuFor, setOverlayMenuFor] = useState<string | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);

  const imageCount = state.project.sources.filter((s) => s.kind === "image" && !s.isPlaceholder).length;

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const isSupported = ["video/", "audio/", "image/"].some((prefix) => file.type.startsWith(prefix));
      if (!isSupported) continue;
      try {
        const source = await readMediaMetadata(file);
        await saveMediaBlob(source.id, file);
        dispatch({ type: "ADD_SOURCE", source });
      } catch (err) {
        console.error(err);
      }
    }
  }

  // Append to the end of a track's clip sequence — images land on the video track as a still, just
  // like video, rather than floating on top as an overlay (that's the caret menu below).
  function appendToTrack(source: MediaSource, trackId: string) {
    const clipsOnTrack = state.project.clips.filter((c) => c.trackId === trackId);
    dispatch({ type: "ADD_CLIP", trackId, sourceId: source.id, atIndex: clipsOnTrack.length });
  }

  function handleAppend(source: MediaSource) {
    if (source.kind === "audio") {
      const trackId = state.activeAudioTrackId ?? getTracksByKind(state.project, "audio")[0]?.id;
      if (trackId) appendToTrack(source, trackId);
      return;
    }
    appendToTrack(source, VIDEO_TRACK_ID);
  }

  function handleAddAsOverlay(source: MediaSource) {
    dispatch({
      type: "ADD_IMAGE_OVERLAY",
      trackId: OVERLAY_TRACK_ID,
      sourceId: source.id,
      start: state.playhead,
      end: state.playhead + DEFAULT_LOGO_DURATION_SECONDS,
    });
    setOverlayMenuFor(null);
  }

  async function handleRemove(source: MediaSource) {
    dispatch({ type: "REMOVE_SOURCE", sourceId: source.id });
    if (source.previewUrl) URL.revokeObjectURL(source.previewUrl);
    try {
      await deleteMediaBlob(source.id);
    } catch (err) {
      console.error("Failed to delete stored media", err);
    }
  }

  async function handleRemoveAll() {
    const sources = state.project.sources;
    if (sources.length === 0) return;
    if (!window.confirm(`Remove all ${sources.length} media item${sources.length === 1 ? "" : "s"}? This also clears every clip using them.`)) {
      return;
    }
    dispatch({ type: "REMOVE_ALL_SOURCES" });
    for (const source of sources) {
      if (source.previewUrl) URL.revokeObjectURL(source.previewUrl);
      try {
        await deleteMediaBlob(source.id);
      } catch (err) {
        console.error("Failed to delete stored media", err);
      }
    }
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
      <div className="media-library-header">
        <h2>Media</h2>
        <label className="import-button">
          Import files
          <input type="file" accept="video/*,audio/*,image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        </label>
        {imageCount >= 2 && (
          <button type="button" className="slideshow-button" onClick={() => setSlideshowOpen(true)}>
            ＋ Slideshow from images
          </button>
        )}
        {state.project.sources.length > 0 && (
          <button type="button" className="media-remove-all" onClick={handleRemoveAll}>
            Remove all
          </button>
        )}
      </div>
      {state.project.sources.length === 0 && <p className="hint">Drop video/audio/image files here, or use Import.</p>}
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
            <span className={`media-kind media-kind-${source.kind}`}>{MEDIA_KIND_LABEL[source.kind]}</span>
            <span className="media-name">{source.name}</span>
            <button type="button" onClick={() => handleAppend(source)} title="Add to timeline">
              +
            </button>
            {source.kind === "image" && (
              <div className="media-more">
                <button
                  type="button"
                  onClick={() => setOverlayMenuFor(overlayMenuFor === source.id ? null : source.id)}
                  title="More ways to add"
                >
                  ⌄
                </button>
                {overlayMenuFor === source.id && (
                  <div className="track-add-menu media-more-menu" onMouseLeave={() => setOverlayMenuFor(null)}>
                    <button type="button" onClick={() => handleAddAsOverlay(source)}>
                      Add as overlay (on top)
                    </button>
                  </div>
                )}
              </div>
            )}
            <button type="button" className="media-remove" onClick={() => handleRemove(source)} title="Delete from library">
              ×
            </button>
          </li>
        ))}
      </ul>
      {slideshowOpen && <SlideshowDialog onClose={() => setSlideshowOpen(false)} />}
    </div>
  );
}
