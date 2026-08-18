import { useEditorState } from "../state/EditorContext.js";
import { BulkEditPanel } from "./BulkEditPanel.js";
import { ClipInspector } from "./ClipInspector.js";
import { OverlayInspector } from "./OverlayInspector.js";

export function Inspector() {
  const state = useEditorState();

  if (state.selectedOverlayId) return <OverlayInspector />;
  if (state.selectedClipId) return <ClipInspector />;
  return <BulkEditPanel />;
}
