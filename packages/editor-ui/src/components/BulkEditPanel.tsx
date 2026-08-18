import { useState } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";

const MAX_BULK_FADE_SECONDS = 5;

export function BulkEditPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [target, setTarget] = useState<"video" | "audio">("video");
  const trackId = target === "video" ? VIDEO_TRACK_ID : AUDIO_TRACK_ID;
  const clips = state.project.clips.filter((c) => c.trackId === trackId);

  function applyFade(fadeInSeconds: number, fadeOutSeconds: number) {
    dispatch({ type: "BULK_SET_FADE", trackId, fadeInSeconds, fadeOutSeconds });
  }

  const avgFadeIn = clips.length ? clips.reduce((sum, c) => sum + c.fadeInSeconds, 0) / clips.length : 0;
  const avgFadeOut = clips.length ? clips.reduce((sum, c) => sum + c.fadeOutSeconds, 0) / clips.length : 0;
  const avgVolume = clips.length ? clips.reduce((sum, c) => sum + c.volume, 0) / clips.length : 1;

  return (
    <div className="clip-inspector">
      <h2>Bulk edit</h2>
      <p className="hint">Nothing selected — apply changes to every clip on a track at once.</p>

      <div className="field">
        <span>Track</span>
        <div className="inline-fields">
          <button type="button" className={target === "video" ? "active" : ""} onClick={() => setTarget("video")}>
            Video
          </button>
          <button type="button" className={target === "audio" ? "active" : ""} onClick={() => setTarget("audio")}>
            Audio
          </button>
        </div>
      </div>

      <p className="hint">{clips.length} clip{clips.length === 1 ? "" : "s"} on this track.</p>

      <div className="field">
        <span>Mute</span>
        <div className="inline-fields">
          <button type="button" disabled={clips.length === 0} onClick={() => dispatch({ type: "BULK_MUTE", trackId, muted: true })}>
            Mute all
          </button>
          <button
            type="button"
            disabled={clips.length === 0}
            onClick={() => dispatch({ type: "BULK_MUTE", trackId, muted: false })}
          >
            Unmute all
          </button>
        </div>
      </div>

      <label className="field">
        <span>Volume — {Math.round(avgVolume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={avgVolume}
          disabled={clips.length === 0}
          onChange={(e) => dispatch({ type: "BULK_SET_VOLUME", trackId, volume: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Fade in (all) — {avgFadeIn.toFixed(1)}s</span>
        <input
          type="range"
          min={0}
          max={MAX_BULK_FADE_SECONDS}
          step={0.1}
          value={avgFadeIn}
          disabled={clips.length === 0}
          onChange={(e) => applyFade(Number(e.target.value), avgFadeOut)}
        />
      </label>

      <label className="field">
        <span>Fade out (all) — {avgFadeOut.toFixed(1)}s</span>
        <input
          type="range"
          min={0}
          max={MAX_BULK_FADE_SECONDS}
          step={0.1}
          value={avgFadeOut}
          disabled={clips.length === 0}
          onChange={(e) => applyFade(avgFadeIn, Number(e.target.value))}
        />
      </label>
    </div>
  );
}
