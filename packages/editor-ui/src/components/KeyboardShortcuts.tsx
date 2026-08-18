import { useEffect } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";

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

      if ((e.key === "Delete" || e.key === "Backspace") && state.selectedClipId) {
        e.preventDefault();
        dispatch({ type: "REMOVE_CLIP", clipId: state.selectedClipId });
        return;
      }

      const isModifier = e.metaKey || e.ctrlKey;
      if (isModifier && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
        return;
      }

      if (!isModifier && e.key.toLowerCase() === "s" && state.selectedClipId) {
        e.preventDefault();
        dispatch({ type: "SPLIT_CLIP", clipId: state.selectedClipId, atTime: state.playhead });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, state.isPlaying, state.selectedClipId, state.playhead]);

  return null;
}
