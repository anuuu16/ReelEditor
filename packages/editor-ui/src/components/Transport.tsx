import type { ChangeEvent } from "react";
import { getSequenceDuration, layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const rest = (s % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${rest}`;
}

export function Transport() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const videoClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));
  const audioClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === AUDIO_TRACK_ID));
  const totalDuration = Math.max(getSequenceDuration(videoClips), getSequenceDuration(audioClips));

  function togglePlay() {
    dispatch({ type: state.isPlaying ? "PAUSE" : "PLAY" });
  }

  function handleScrub(e: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "SET_PLAYHEAD", time: Number(e.target.value) });
  }

  return (
    <div className="transport">
      <button type="button" onClick={togglePlay} disabled={totalDuration === 0}>
        {state.isPlaying ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={totalDuration || 0}
        step={0.01}
        value={Math.min(state.playhead, totalDuration)}
        onChange={handleScrub}
        disabled={totalDuration === 0}
      />
      <span className="time-display">
        {formatTime(state.playhead)} / {formatTime(totalDuration)}
      </span>
    </div>
  );
}
