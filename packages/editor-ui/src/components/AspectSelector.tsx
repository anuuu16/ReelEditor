import { ASPECT_RATIO_PRESETS } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";

export function AspectSelector() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  return (
    <div className="aspect-selector">
      {ASPECT_RATIO_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={state.project.canvas.aspectRatio === preset.id ? "active" : ""}
          onClick={() => dispatch({ type: "SET_ASPECT", aspectRatio: preset.id, width: preset.width, height: preset.height })}
        >
          {preset.id}
        </button>
      ))}
    </div>
  );
}
