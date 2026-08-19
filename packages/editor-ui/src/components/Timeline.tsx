import { useState } from "react";
import { getProjectDuration, getTracksByKind } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { PIXELS_PER_SECOND_DEFAULT, PIXELS_PER_SECOND_MAX, PIXELS_PER_SECOND_MIN } from "../constants.js";
import { MagnifierIcon } from "./MagnifierIcon.js";
import { OverlayTrackRow } from "./OverlayTrackRow.js";
import { Playhead } from "./Playhead.js";
import { TimeRuler } from "./TimeRuler.js";
import { TrackRow } from "./TrackRow.js";

export function Timeline() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [pixelsPerSecond, setPixelsPerSecond] = useState(PIXELS_PER_SECOND_DEFAULT);

  const audioTracks = getTracksByKind(state.project, "audio");
  const overlaysEnd = state.project.overlays.reduce((end, o) => Math.max(end, o.end), 0);
  const totalDuration = getProjectDuration(state.project, [overlaysEnd]);

  function zoomIn() {
    setPixelsPerSecond((p) => Math.min(PIXELS_PER_SECOND_MAX, Math.round(p * 1.25)));
  }

  function zoomOut() {
    setPixelsPerSecond((p) => Math.max(PIXELS_PER_SECOND_MIN, Math.round(p / 1.25)));
  }

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <div className="timeline-content">
          <TimeRuler pixelsPerSecond={pixelsPerSecond} durationSeconds={totalDuration} />
          <TrackRow trackId={VIDEO_TRACK_ID} label="Video" accept="video" pixelsPerSecond={pixelsPerSecond} />
          {audioTracks.map((track, i) => (
            <TrackRow
              key={track.id}
              trackId={track.id}
              label={audioTracks.length > 1 ? `Audio ${i + 1}` : "Audio"}
              accept="audio"
              pixelsPerSecond={pixelsPerSecond}
              isActive={state.activeAudioTrackId === track.id}
              onSelect={() => dispatch({ type: "SELECT_TRACK", trackId: track.id })}
              onRemove={audioTracks.length > 1 ? () => dispatch({ type: "REMOVE_TRACK", trackId: track.id }) : undefined}
            />
          ))}
          <OverlayTrackRow pixelsPerSecond={pixelsPerSecond} />
          <Playhead pixelsPerSecond={pixelsPerSecond} totalDuration={totalDuration} />
        </div>
      </div>
      <div className="timeline-add-track">
        <button type="button" onClick={() => dispatch({ type: "ADD_TRACK", kind: "audio" })}>
          + Add audio track
        </button>
      </div>
      <div className="timeline-toolbar">
        <button type="button" onClick={zoomOut} title="Zoom out">
          <MagnifierIcon variant="out" />
        </button>
        <button type="button" onClick={zoomIn} title="Zoom in">
          <MagnifierIcon variant="in" />
        </button>
      </div>
    </div>
  );
}
