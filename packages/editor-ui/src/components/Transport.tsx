import type { ChangeEvent } from "react";
import { getSequenceDuration, layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorHistory, useEditorState } from "../state/EditorContext.js";
import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { previewCanvasRef } from "../state/previewCanvasRef.js";

function formatTimecode(totalSeconds: number, frameRate: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const frames = Math.floor((clamped - Math.floor(clamped)) * frameRate);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
}

export function Transport() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const { canUndo, canRedo } = useEditorHistory();
  const videoClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));
  const audioClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === AUDIO_TRACK_ID));
  const overlaysEnd = state.project.overlays.reduce((end, o) => Math.max(end, o.end), 0);
  const totalDuration = Math.max(getSequenceDuration(videoClips), getSequenceDuration(audioClips), overlaysEnd);
  const frameRate = state.project.canvas.frameRate;
  const frameDuration = 1 / frameRate;

  function togglePlay() {
    dispatch({ type: state.isPlaying ? "PAUSE" : "PLAY" });
  }

  function handleScrub(e: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "SET_PLAYHEAD", time: Number(e.target.value) });
  }

  function stepFrame(direction: 1 | -1) {
    dispatch({ type: "PAUSE" });
    const next = state.playhead + direction * frameDuration;
    dispatch({ type: "SET_PLAYHEAD", time: Math.max(0, Math.min(next, totalDuration)) });
  }

  function handleSplit() {
    if (!state.selectedClipId) return;
    dispatch({ type: "SPLIT_CLIP", clipId: state.selectedClipId, atTime: state.playhead });
  }

  function toggleFullscreen() {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      canvas.requestFullscreen().catch(() => {});
    }
  }

  return (
    <div className="transport">
      <button
        type="button"
        className="icon-button"
        onClick={() => dispatch({ type: "UNDO" })}
        disabled={!canUndo}
        title="Undo (Cmd/Ctrl+Z)"
      >
        ↶
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => dispatch({ type: "REDO" })}
        disabled={!canRedo}
        title="Redo (Cmd/Ctrl+Shift+Z)"
      >
        ↷
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={handleSplit}
        disabled={!state.selectedClipId}
        title="Split at playhead (S)"
      >
        Split
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => dispatch({ type: "TOGGLE_MASTER_MUTE" })}
        title={state.masterMuted ? "Unmute preview" : "Mute preview"}
      >
        {state.masterMuted ? "Muted" : "Sound"}
      </button>
      <span className="time-display">{formatTimecode(state.playhead, frameRate)}</span>
      <button type="button" className="icon-button" onClick={() => stepFrame(-1)} disabled={totalDuration === 0} title="Previous frame">
        ⏮
      </button>
      <button type="button" onClick={togglePlay} disabled={totalDuration === 0}>
        {state.isPlaying ? "Pause" : "Play"}
      </button>
      <button type="button" className="icon-button" onClick={() => stepFrame(1)} disabled={totalDuration === 0} title="Next frame">
        ⏭
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
      <span className="time-display">{formatTimecode(totalDuration, frameRate)}</span>
      <button type="button" className="icon-button" onClick={toggleFullscreen} title="Fullscreen">
        ⛶
      </button>
    </div>
  );
}
