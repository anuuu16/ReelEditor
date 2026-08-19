import { useEffect } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { findMergeableNeighbor } from "../state/reducer.js";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function KeyboardShortcuts() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        dispatch({ type: state.isPlaying ? "PAUSE" : "PLAY" });
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selectedClipId) {
          e.preventDefault();
          dispatch({ type: "REMOVE_CLIP", clipId: state.selectedClipId });
          return;
        }
        if (state.selectedOverlayId) {
          e.preventDefault();
          dispatch({ type: "REMOVE_OVERLAY", overlayId: state.selectedOverlayId });
          return;
        }
      }

      const isModifier = e.metaKey || e.ctrlKey;
      if (isModifier && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
        return;
      }

      if (isModifier && e.key.toLowerCase() === "d" && state.selectedClipId) {
        e.preventDefault();
        dispatch({ type: "DUPLICATE_CLIP", clipId: state.selectedClipId });
        return;
      }

      if (!isModifier && e.key.toLowerCase() === "s" && state.selectedClipId) {
        e.preventDefault();
        dispatch({ type: "SPLIT_CLIP", clipId: state.selectedClipId, atTime: state.playhead });
        return;
      }

      if (!isModifier && e.key.toLowerCase() === "m" && state.selectedClipId) {
        const clip = state.project.clips.find((c) => c.id === state.selectedClipId);
        if (clip && findMergeableNeighbor(state.project.clips, clip)) {
          e.preventDefault();
          dispatch({ type: "MERGE_CLIP", clipId: state.selectedClipId });
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, state.isPlaying, state.selectedClipId, state.selectedOverlayId, state.playhead, state.project.clips]);

  return null;
}
