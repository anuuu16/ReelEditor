import type { EndBehavior } from "@reel-studio/shared-types";
import {
  getOverlaysEnd,
  getSequenceDuration,
  getTracksByKind,
  getVideoSequenceDuration,
  layoutTrackClips,
} from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";

const OPTIONS: { value: EndBehavior; label: string; hint: string }[] = [
  { value: "black", label: "Black", hint: "Show a black screen once the video runs out, until the music/titles finish." },
  { value: "freeze", label: "Freeze", hint: "Hold the video's last frame until the music/titles finish." },
  { value: "trim", label: "Trim", hint: "Cut the whole reel to the video's length — drop any music/titles past that point." },
];

// How long everything BUT the video track runs — the video's own endBehavior only ever matters
// when something else (usually music, sometimes a title) outlasts it.
function getNonVideoEnd(state: ReturnType<typeof useEditorState>): number {
  const audioEnd = Math.max(
    0,
    ...getTracksByKind(state.project, "audio").map((t) => getSequenceDuration(layoutTrackClips(state.project, t.id))),
  );
  return Math.max(audioEnd, getOverlaysEnd(state.project));
}

// One small control, visible wherever the timeline is — the one place this choice is made, read by
// the player and the export alike (see ProjectModel.endBehavior), so there's never a second control
// that could disagree with it.
export function EndingControl() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const videoLength = getVideoSequenceDuration(state.project);
  const matters = getNonVideoEnd(state) > videoLength + 0.0005;

  return (
    <div className="ending-control" title="What plays on the video track once it runs out but music or a title is still going">
      <span className="ending-control-label">When video ends</span>
      <div className="inline-fields">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={state.project.endBehavior === option.value ? "active" : ""}
            title={option.hint}
            onClick={() => dispatch({ type: "SET_END_BEHAVIOR", endBehavior: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {!matters && <span className="ending-control-hint">No effect yet — nothing outlasts the video</span>}
    </div>
  );
}
