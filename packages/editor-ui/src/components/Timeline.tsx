import { useState } from "react";
import { getSequenceDuration, layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorState } from "../state/EditorContext.js";
import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { PIXELS_PER_SECOND_DEFAULT, PIXELS_PER_SECOND_MAX, PIXELS_PER_SECOND_MIN } from "../constants.js";
import { TimeRuler } from "./TimeRuler.js";
import { TrackRow } from "./TrackRow.js";

export function Timeline() {
  const state = useEditorState();
  const [pixelsPerSecond, setPixelsPerSecond] = useState(PIXELS_PER_SECOND_DEFAULT);

  const videoClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));
  const audioClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === AUDIO_TRACK_ID));
  const totalDuration = Math.max(getSequenceDuration(videoClips), getSequenceDuration(audioClips));

  function zoomIn() {
    setPixelsPerSecond((p) => Math.min(PIXELS_PER_SECOND_MAX, Math.round(p * 1.25)));
  }

  function zoomOut() {
    setPixelsPerSecond((p) => Math.max(PIXELS_PER_SECOND_MIN, Math.round(p / 1.25)));
  }

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button type="button" onClick={zoomOut} title="Zoom out">
          −
        </button>
        <button type="button" onClick={zoomIn} title="Zoom in">
          +
        </button>
      </div>
      <div className="timeline-scroll">
        <TimeRuler pixelsPerSecond={pixelsPerSecond} durationSeconds={totalDuration} />
        <TrackRow trackId={VIDEO_TRACK_ID} label="Video" accept="video" pixelsPerSecond={pixelsPerSecond} />
        <TrackRow trackId={AUDIO_TRACK_ID} label="Audio" accept="audio" pixelsPerSecond={pixelsPerSecond} />
      </div>
    </div>
  );
}
