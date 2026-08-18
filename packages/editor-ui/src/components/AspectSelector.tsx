import type { AspectRatioPreset } from "@reel-studio/shared-types";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";

const PRESETS: Array<{ id: Exclude<AspectRatioPreset, "custom">; width: number; height: number }> = [
  { id: "9:16", width: 1080, height: 1920 },
  { id: "1:1", width: 1080, height: 1080 },
  { id: "16:9", width: 1920, height: 1080 },
  { id: "4:5", width: 1080, height: 1350 },
  { id: "4:3", width: 1440, height: 1080 },
];

export function AspectSelector() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  return (
    <div className="aspect-selector">
      {PRESETS.map((preset) => (
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
