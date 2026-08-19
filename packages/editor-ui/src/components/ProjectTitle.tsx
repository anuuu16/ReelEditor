import type { ChangeEvent } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";

export function ProjectTitle() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "SET_PROJECT_NAME", name: e.target.value });
  }

  return (
    <input
      className="project-title"
      value={state.project.metadata.name}
      onChange={handleChange}
      placeholder="Untitled reel"
      size={Math.max(state.project.metadata.name.length, 8)}
    />
  );
}
