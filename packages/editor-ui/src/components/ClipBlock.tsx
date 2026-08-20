import { useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { LaidOutClip } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { MIN_CLIP_DURATION_SECONDS } from "../state/reducer.js";
import { trackKindAccepts } from "../media/trackAccepts.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { ClipContextMenu, ClipContextMenuDivider, ClipContextMenuItem } from "./ClipContextMenu.js";
import { ClipThumbnailStrip } from "./ClipThumbnailStrip.js";
import { ClipWaveform } from "./ClipWaveform.js";
import {
  DuplicateIcon,
  InsertAfterIcon,
  InsertBeforeIcon,
  MoreIcon,
  MoveLeftIcon,
  MoveRightIcon,
  MuteIcon,
  ReplaceIcon,
  SplitIcon,
  TrashIcon,
  UnmuteIcon,
} from "./icons.js";
import { MediaPickerModal } from "./MediaPickerModal.js";

interface ClipBlockProps {
  clip: LaidOutClip;
  index: number;
  pixelsPerSecond: number;
}

interface TrimDragState {
  edge: "left" | "right";
  startClientX: number;
  startValue: number;
}

type PickerMode = "insert-before" | "insert-after" | "replace" | null;

export function ClipBlock({ clip, index, pixelsPerSecond }: ClipBlockProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const source = state.project.sources.find((s) => s.id === clip.sourceId);
  const isSelected = state.selectedClipId === clip.id;
  const widthPx = Math.max(clip.duration * pixelsPerSecond, 4);
  const trimDragRef = useRef<TrimDragState | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);

  const trackClips = state.project.clips.filter((c) => c.trackId === clip.trackId);
  const canMoveLeft = index > 0;
  const canMoveRight = index < trackClips.length - 1;
  const trackKind = clip.trackId === VIDEO_TRACK_ID ? "video" : "audio";
  const insertCandidates = state.project.sources.filter((s) => !s.isPlaceholder && trackKindAccepts(trackKind, s.kind));
  const replaceCandidates = state.project.sources.filter(
    (s) => !s.isPlaceholder && s.kind === source?.kind && s.id !== clip.sourceId
  );
  const playheadWithinClip = state.playhead > clip.timelineStart && state.playhead < clip.timelineStart + clip.duration;

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData("application/x-clip-id", clip.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleSelect(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "SELECT_CLIP", clipId: clip.id });
  }

  function handleToggleMute(e: MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "UPDATE_CLIP", clipId: clip.id, patch: { muted: !clip.muted } });
  }

  function openMenu(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    dispatch({ type: "SELECT_CLIP", clipId: clip.id });
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  function closeMenu() {
    setMenuPos(null);
  }

  function handleMove(atIndex: number) {
    dispatch({ type: "MOVE_CLIP", clipId: clip.id, trackId: clip.trackId, atIndex });
    closeMenu();
  }

  function handleDuplicate() {
    dispatch({ type: "DUPLICATE_CLIP", clipId: clip.id });
    closeMenu();
  }

  function handleSplitAtPlayhead() {
    dispatch({ type: "SPLIT_CLIP", clipId: clip.id, atTime: state.playhead });
    closeMenu();
  }

  function handleRemove() {
    dispatch({ type: "REMOVE_CLIP", clipId: clip.id });
    closeMenu();
  }

  function handlePickerChoose(sourceId: string) {
    if (pickerMode === "insert-before") {
      dispatch({ type: "ADD_CLIP", trackId: clip.trackId, sourceId, atIndex: index });
    } else if (pickerMode === "insert-after") {
      dispatch({ type: "ADD_CLIP", trackId: clip.trackId, sourceId, atIndex: index + 1 });
    } else if (pickerMode === "replace") {
      dispatch({ type: "REPLACE_CLIP_SOURCE", clipId: clip.id, sourceId });
    }
    setPickerMode(null);
  }

  function handleTrimPointerDown(edge: "left" | "right", e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    trimDragRef.current = { edge, startClientX: e.clientX, startValue: edge === "left" ? clip.inPoint : clip.outPoint };
  }

  function handleTrimPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const drag = trimDragRef.current;
    if (!drag) return;
    const deltaSeconds = (e.clientX - drag.startClientX) / pixelsPerSecond;
    if (drag.edge === "left") {
      const next = Math.max(0, Math.min(drag.startValue + deltaSeconds, clip.outPoint - MIN_CLIP_DURATION_SECONDS));
      dispatch({ type: "UPDATE_CLIP", clipId: clip.id, patch: { inPoint: next } });
    } else {
      const maxOut = source?.durationSeconds ?? drag.startValue;
      const next = Math.min(maxOut, Math.max(drag.startValue + deltaSeconds, clip.inPoint + MIN_CLIP_DURATION_SECONDS));
      dispatch({ type: "UPDATE_CLIP", clipId: clip.id, patch: { outPoint: next } });
    }
  }

  function handleTrimPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    trimDragRef.current = null;
  }

  return (
    <div
      className={`clip-block${isSelected ? " selected" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onClick={handleSelect}
      onContextMenu={openMenu}
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
          className={`clip-icon-button clip-mute-toggle${clip.muted ? " muted" : ""}`}
          draggable={false}
          onClick={handleToggleMute}
          title={clip.muted ? "Unmute" : "Mute"}
        >
          {clip.muted ? <MuteIcon /> : <UnmuteIcon />}
        </button>
        <span className="clip-name">
          {index + 1}. {clip.label || source?.name || "clip"}
        </span>
        <button
          type="button"
          className="clip-icon-button clip-more-button"
          draggable={false}
          onClick={openMenu}
          title="Clip actions"
        >
          <MoreIcon />
        </button>
      </div>
      <div
        className="clip-trim-handle clip-trim-handle-left"
        draggable={false}
        onPointerDown={(e) => handleTrimPointerDown("left", e)}
        onPointerMove={handleTrimPointerMove}
        onPointerUp={handleTrimPointerUp}
      />
      <div
        className="clip-trim-handle clip-trim-handle-right"
        draggable={false}
        onPointerDown={(e) => handleTrimPointerDown("right", e)}
        onPointerMove={handleTrimPointerMove}
        onPointerUp={handleTrimPointerUp}
      />

      {menuPos && (
        <ClipContextMenu x={menuPos.x} y={menuPos.y} onClose={closeMenu}>
          <ClipContextMenuItem
            icon={<SplitIcon />}
            label="Split at playhead"
            disabled={!playheadWithinClip}
            onSelect={handleSplitAtPlayhead}
          />
          <ClipContextMenuItem icon={<DuplicateIcon />} label="Duplicate" onSelect={handleDuplicate} />
          <ClipContextMenuDivider />
          <ClipContextMenuItem
            icon={<InsertBeforeIcon />}
            label="Insert clip before…"
            disabled={insertCandidates.length === 0}
            onSelect={() => {
              setPickerMode("insert-before");
              closeMenu();
            }}
          />
          <ClipContextMenuItem
            icon={<InsertAfterIcon />}
            label="Insert clip after…"
            disabled={insertCandidates.length === 0}
            onSelect={() => {
              setPickerMode("insert-after");
              closeMenu();
            }}
          />
          <ClipContextMenuItem
            icon={<ReplaceIcon />}
            label="Replace media…"
            disabled={replaceCandidates.length === 0}
            onSelect={() => {
              setPickerMode("replace");
              closeMenu();
            }}
          />
          <ClipContextMenuDivider />
          <ClipContextMenuItem
            icon={<MoveLeftIcon />}
            label="Swap with previous"
            disabled={!canMoveLeft}
            onSelect={() => handleMove(index - 1)}
          />
          <ClipContextMenuItem
            icon={<MoveRightIcon />}
            label="Swap with next"
            disabled={!canMoveRight}
            onSelect={() => handleMove(index + 1)}
          />
          <ClipContextMenuDivider />
          <ClipContextMenuItem icon={<TrashIcon />} label="Remove clip" destructive onSelect={handleRemove} />
        </ClipContextMenu>
      )}

      {pickerMode === "insert-before" && (
        <MediaPickerModal
          title="Insert clip before this one"
          candidates={insertCandidates}
          onChoose={handlePickerChoose}
          onClose={() => setPickerMode(null)}
        />
      )}
      {pickerMode === "insert-after" && (
        <MediaPickerModal
          title="Insert clip after this one"
          candidates={insertCandidates}
          onChoose={handlePickerChoose}
          onClose={() => setPickerMode(null)}
        />
      )}
      {pickerMode === "replace" && (
        <MediaPickerModal
          title="Replace media"
          hint="Keeps this clip's position and trim."
          candidates={replaceCandidates}
          onChoose={handlePickerChoose}
          onClose={() => setPickerMode(null)}
        />
      )}
    </div>
  );
}
