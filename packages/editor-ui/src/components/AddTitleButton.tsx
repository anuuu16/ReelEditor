import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { OVERLAY_TRACK_ID } from "../state/initialProject.js";

const DEFAULT_TITLE_DURATION_SECONDS = 3;

export function AddTitleButton() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  function handleAdd() {
    dispatch({
      type: "ADD_OVERLAY",
      trackId: OVERLAY_TRACK_ID,
      start: state.playhead,
      end: state.playhead + DEFAULT_TITLE_DURATION_SECONDS,
    });
  }

  return (
    <button type="button" className="add-title-button" onClick={handleAdd}>
      + Title
    </button>
  );
}
