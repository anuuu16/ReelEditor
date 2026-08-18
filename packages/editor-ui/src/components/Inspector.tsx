import { useEditorState } from "../state/EditorContext.js";
import { ClipInspector } from "./ClipInspector.js";
import { OverlayInspector } from "./OverlayInspector.js";

export function Inspector() {
  const state = useEditorState();

  if (state.selectedOverlayId) return <OverlayInspector />;
  return <ClipInspector />;
}
