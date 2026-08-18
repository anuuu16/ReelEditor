import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { OVERLAY_TRACK_ID } from "../state/initialProject.js";
import { OverlayBlock } from "./OverlayBlock.js";

interface OverlayTrackRowProps {
  pixelsPerSecond: number;
}

export function OverlayTrackRow({ pixelsPerSecond }: OverlayTrackRowProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const overlays = state.project.overlays.filter((o) => o.trackId === OVERLAY_TRACK_ID);
  const laneWidth = overlays.reduce((end, o) => Math.max(end, o.end), 0) * pixelsPerSecond;

  return (
    <div className="track-row">
      <div className="track-label">Text</div>
      <div
        className="track-lane track-lane-overlay"
        style={{ width: Math.max(laneWidth, 600) }}
        onClick={() => dispatch({ type: "SELECT_OVERLAY", overlayId: null })}
      >
        {overlays.map((overlay) => (
          <OverlayBlock key={overlay.id} overlay={overlay} pixelsPerSecond={pixelsPerSecond} />
        ))}
      </div>
    </div>
  );
}
