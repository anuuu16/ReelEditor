import { useState } from "react";
import type { ClipFilter, Transform, TransitionType } from "@reel-studio/shared-types";
import {
  applyFilterPreset,
  getSequenceDuration,
  getTracksByKind,
  layoutSequentialClips,
  type FilterPresetName,
} from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";

const MAX_BULK_FADE_SECONDS = 5;
const FILTER_PRESET_NAMES: FilterPresetName[] = ["none", "warm", "cool", "mono", "vintage"];
const TRANSITION_TYPE_NAMES: TransitionType[] = ["dissolve", "slide", "wipe", "zoom"];
const TRANSITION_TYPE_LABELS: Record<TransitionType, string> = {
  dissolve: "Dissolve",
  slide: "Slide",
  wipe: "Wipe",
  zoom: "Zoom",
};

export function BulkEditPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [trackId, setTrackId] = useState<string>(VIDEO_TRACK_ID);
  const [compensateLength, setCompensateLength] = useState(true);
  const audioTracks = getTracksByKind(state.project, "audio");
  const isVideoTrack = trackId === VIDEO_TRACK_ID;
  const clips = state.project.clips.filter((c) => c.trackId === trackId);
  const totalSeconds = getSequenceDuration(layoutSequentialClips(clips));

  function applyFade(fadeInSeconds: number, fadeOutSeconds: number) {
    dispatch({ type: "BULK_SET_FADE", trackId, fadeInSeconds, fadeOutSeconds });
  }

  function applyFilterPatch(patch: Partial<ClipFilter>) {
    dispatch({ type: "BULK_SET_FILTER", trackId, patch });
  }

  function applyTransformPatch(patch: Partial<Transform>) {
    dispatch({ type: "BULK_SET_TRANSFORM", trackId, patch });
  }

  const avgFadeIn = clips.length ? clips.reduce((sum, c) => sum + c.fadeInSeconds, 0) / clips.length : 0;
  const avgFadeOut = clips.length ? clips.reduce((sum, c) => sum + c.fadeOutSeconds, 0) / clips.length : 0;
  const avgVolume = clips.length ? clips.reduce((sum, c) => sum + c.volume, 0) / clips.length : 1;
  const avgBrightness = clips.length ? clips.reduce((sum, c) => sum + c.filter.brightness, 0) / clips.length : 0;
  const avgContrast = clips.length ? clips.reduce((sum, c) => sum + c.filter.contrast, 0) / clips.length : 1;
  const avgSaturation = clips.length ? clips.reduce((sum, c) => sum + c.filter.saturation, 0) / clips.length : 1;
  const avgHue = clips.length ? clips.reduce((sum, c) => sum + c.filter.hue, 0) / clips.length : 0;
  const avgZoom = clips.length ? clips.reduce((sum, c) => sum + c.transform.scale, 0) / clips.length : 1;
  const avgPanX = clips.length ? clips.reduce((sum, c) => sum + c.transform.x, 0) / clips.length : 0;
  const avgPanY = clips.length ? clips.reduce((sum, c) => sum + c.transform.y, 0) / clips.length : 0;

  const commonFitMode = clips.length && clips.every((c) => c.fitMode === clips[0].fitMode) ? clips[0].fitMode : null;
  const commonPreset =
    clips.length && clips.every((c) => (c.filter.preset ?? "none") === (clips[0].filter.preset ?? "none"))
      ? clips[0].filter.preset ?? "none"
      : null;
  const avgTransitionSeconds = clips.length ? clips.reduce((sum, c) => sum + c.transitionOutSeconds, 0) / clips.length : 0;
  const allNoTransition = clips.length > 0 && clips.every((c) => c.transitionOutSeconds === 0);
  const anyHasTransition = clips.some((c) => c.transitionOutSeconds > 0);
  const commonTransitionType =
    clips.length && clips.every((c) => c.transitionOutType === clips[0].transitionOutType) ? clips[0].transitionOutType : null;

  function applyTransition(transitionOutSeconds: number, transitionOutType: TransitionType) {
    dispatch({ type: "BULK_SET_TRANSITION", trackId, transitionOutSeconds, transitionOutType, compensateLength });
  }

  return (
    <div className="clip-inspector">
      <h2>Bulk edit</h2>
      <p className="hint">Nothing selected — apply changes to every clip on a track at once.</p>

      <div className="field">
        <span>Track</span>
        <div className="inline-fields inline-fields-wrap">
          <button type="button" className={trackId === VIDEO_TRACK_ID ? "active" : ""} onClick={() => setTrackId(VIDEO_TRACK_ID)}>
            Video
          </button>
          {audioTracks.map((track, i) => (
            <button key={track.id} type="button" className={trackId === track.id ? "active" : ""} onClick={() => setTrackId(track.id)}>
              {audioTracks.length > 1 ? `Audio ${i + 1}` : "Audio"}
            </button>
          ))}
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

      {isVideoTrack && (
        <>
          <div className="field">
            <span>Frame fit (all)</span>
            <div className="inline-fields">
              <button
                type="button"
                className={commonFitMode === "fit" ? "active" : ""}
                disabled={clips.length === 0}
                title="Show the whole frame, with letterbox bars if the aspect ratio doesn't match"
                onClick={() => dispatch({ type: "BULK_SET_FIT_MODE", trackId, fitMode: "fit" })}
              >
                Fit (letterbox)
              </button>
              <button
                type="button"
                className={commonFitMode === "fill" ? "active" : ""}
                disabled={clips.length === 0}
                title="Fill the canvas edge-to-edge, cropping anything that doesn't fit"
                onClick={() => dispatch({ type: "BULK_SET_FIT_MODE", trackId, fitMode: "fill" })}
              >
                Fill (crop)
              </button>
              <button
                type="button"
                className={commonFitMode === "stretch" ? "active" : ""}
                disabled={clips.length === 0}
                title="Stretch width and height independently to exactly fill the canvas, distorting the image"
                onClick={() => dispatch({ type: "BULK_SET_FIT_MODE", trackId, fitMode: "stretch" })}
              >
                Stretch
              </button>
            </div>
          </div>

          <label className="field">
            <span>Zoom (all) — {avgZoom.toFixed(2)}x</span>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.05}
              value={avgZoom}
              disabled={clips.length === 0}
              onChange={(e) => applyTransformPatch({ scale: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Pan X (all) — {Math.round(avgPanX * 100)}</span>
            <input
              type="range"
              min={-0.4}
              max={0.4}
              step={0.01}
              value={avgPanX}
              disabled={clips.length === 0}
              onChange={(e) => applyTransformPatch({ x: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Pan Y (all) — {Math.round(avgPanY * 100)}</span>
            <input
              type="range"
              min={-0.4}
              max={0.4}
              step={0.01}
              value={avgPanY}
              disabled={clips.length === 0}
              onChange={(e) => applyTransformPatch({ y: Number(e.target.value) })}
            />
          </label>

          <div className="field">
            <span>Filter (all)</span>
            <div className="inline-fields inline-fields-wrap">
              {FILTER_PRESET_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={commonPreset === name ? "active" : ""}
                  disabled={clips.length === 0}
                  onClick={() => dispatch({ type: "BULK_SET_FILTER", trackId, patch: applyFilterPreset(name) })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Brightness (all) — {avgBrightness > 0 ? "+" : ""}{Math.round(avgBrightness * 100)}</span>
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.01}
              value={avgBrightness}
              disabled={clips.length === 0}
              onChange={(e) => applyFilterPatch({ preset: null, brightness: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Contrast (all) — {Math.round(avgContrast * 100)}%</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.01}
              value={avgContrast}
              disabled={clips.length === 0}
              onChange={(e) => applyFilterPatch({ preset: null, contrast: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Saturation (all) — {Math.round(avgSaturation * 100)}%</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={avgSaturation}
              disabled={clips.length === 0}
              onChange={(e) => applyFilterPatch({ preset: null, saturation: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Hue (all) — {Math.round(avgHue)}°</span>
            <input
              type="range"
              min={-30}
              max={30}
              step={1}
              value={avgHue}
              disabled={clips.length === 0}
              onChange={(e) => applyFilterPatch({ preset: null, hue: Number(e.target.value) })}
            />
          </label>

          <div className="field">
            <span>Transition to next clip (all) — {totalSeconds.toFixed(1)}s total</span>
            <div className="inline-fields inline-fields-wrap">
              <button
                type="button"
                className={allNoTransition ? "active" : ""}
                disabled={clips.length === 0}
                onClick={() => applyTransition(0, commonTransitionType ?? "dissolve")}
              >
                None (cut)
              </button>
              {TRANSITION_TYPE_NAMES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={anyHasTransition && commonTransitionType === type ? "active" : ""}
                  disabled={clips.length === 0}
                  onClick={() => applyTransition(avgTransitionSeconds > 0 ? avgTransitionSeconds : 0.5, type)}
                >
                  {TRANSITION_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          <label className="field checkbox-field">
            <input type="checkbox" checked={compensateLength} onChange={(e) => setCompensateLength(e.target.checked)} />
            <span title="Compensates each clip for the overlap so adding a transition doesn't shorten the total — extends into unused source footage first, then nudges playback speed down slightly for whatever footage can't cover (most imported clips use their full source length, so speed does most of the work).">
              Keep total length
            </span>
          </label>

          {anyHasTransition && (
            <label className="field">
              <span>
                {commonTransitionType ? TRANSITION_TYPE_LABELS[commonTransitionType] : "Transition"} duration (all) —{" "}
                {avgTransitionSeconds.toFixed(1)}s
              </span>
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.1}
                value={avgTransitionSeconds}
                disabled={clips.length === 0}
                onChange={(e) => applyTransition(Number(e.target.value), commonTransitionType ?? "dissolve")}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
