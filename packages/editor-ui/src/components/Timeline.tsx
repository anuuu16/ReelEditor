import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { TrackRow } from "./TrackRow.js";

export function Timeline() {
  return (
    <div className="timeline">
      <TrackRow trackId={VIDEO_TRACK_ID} label="Video" accept="video" />
      <TrackRow trackId={AUDIO_TRACK_ID} label="Audio" accept="audio" />
    </div>
  );
}
