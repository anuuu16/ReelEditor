import { useEffect, useState } from "react";
import type { Clip, ClipFilter, Transform, TransitionType } from "@reel-studio/shared-types";
import { applyFilterPreset, type FilterPresetName } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { trackKindAccepts } from "../media/trackAccepts.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";

const FILTER_PRESET_NAMES: FilterPresetName[] = ["none", "warm", "cool", "mono", "vintage"];
const TRANSITION_TYPE_NAMES: TransitionType[] = ["dissolve", "slide", "wipe", "zoom"];
const TRANSITION_TYPE_LABELS: Record<TransitionType, string> = {
  dissolve: "Dissolve",
  slide: "Slide",
  wipe: "Wipe",
  zoom: "Zoom",
};

export function ClipInspector() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const clip = state.project.clips.find((c) => c.id === state.selectedClipId) ?? null;
  const source = clip ? state.project.sources.find((s) => s.id === clip.sourceId) : undefined;
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    setThumbnail(null);
    if (!clip || source?.kind !== "video" || source.isPlaceholder) return;
    let cancelled = false;
    const key = `video:${source.id}:${clip.inPoint}:${clip.outPoint}:1`;
    getOrCreate(key, () => generateVideoThumbnails(source.previewUrl, clip.inPoint, clip.outPoint, 1))
      .then((frames) => {
        if (!cancelled && frames[0]) setThumbnail(frames[0]);
      })
      .catch((err) => console.error("Failed to generate clip thumbnail", err));
    return () => {
      cancelled = true;
    };
  }, [clip?.id, clip?.inPoint, clip?.outPoint, source?.id, source?.previewUrl]);

  if (!clip) return null;

  const duration = (clip.outPoint - clip.inPoint) / clip.speed;
  const maxFade = Math.max(duration / 2, 0.1);
  const replaceCandidates = state.project.sources.filter(
    (s) => s.kind === source?.kind && s.id !== clip.sourceId && !s.isPlaceholder
  );
  const trackClips = state.project.clips.filter((c) => c.trackId === clip.trackId);
  const clipIndex = trackClips.findIndex((c) => c.id === clip.id);
  const hasNextClip = clipIndex !== -1 && clipIndex < trackClips.length - 1;
  const trackKind = clip.trackId === VIDEO_TRACK_ID ? "video" : "audio";
  const insertCandidates = state.project.sources.filter((s) => !s.isPlaceholder && trackKindAccepts(trackKind, s.kind));
  const isVisual = source?.kind === "video" || source?.kind === "image";

  function update(patch: Partial<Clip>) {
    dispatch({ type: "UPDATE_CLIP", clipId: clip!.id, patch });
  }

  function updateFilter(patch: Partial<ClipFilter>) {
    update({ filter: { ...clip!.filter, preset: null, ...patch } });
  }

  function updateTransform(patch: Partial<Transform>) {
    update({ transform: { ...clip!.transform, ...patch } });
  }

  function applyPreset(name: FilterPresetName) {
    update({ filter: applyFilterPreset(name) });
  }

  return (
    <div className="clip-inspector">
      <div className="clip-inspector-header">
        <h2>Clip</h2>
        <button type="button" className="clip-deselect" onClick={() => dispatch({ type: "SELECT_CLIP", clipId: null })}>
          ← Bulk edit all clips
        </button>
      </div>

      <div className={`clip-preview-thumb${source?.kind === "audio" ? " clip-preview-thumb-audio" : ""}`}>
        {thumbnail && <img src={thumbnail} alt="" />}
        {source?.kind === "audio" && <span>Audio</span>}
        {source?.isPlaceholder && <span>Placeholder — use "Replace media" below to add your own footage</span>}
      </div>

      <div className="field">
        <button
          type="button"
          title="Duplicate (Cmd/Ctrl+D)"
          onClick={() => dispatch({ type: "DUPLICATE_CLIP", clipId: clip.id })}
        >
          Duplicate clip
        </button>
      </div>

      {replaceCandidates.length > 0 && (
        <label className="field">
          <span>Replace media (keeps position &amp; trim)</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) dispatch({ type: "REPLACE_CLIP_SOURCE", clipId: clip.id, sourceId: e.target.value });
            }}
          >
            <option value="" disabled>
              Choose a clip to swap in…
            </option>
            {replaceCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {trackClips.length > 1 && (
        <label className="field">
          <span>
            Position — {clipIndex + 1} of {trackClips.length}
          </span>
          <input
            type="number"
            min={1}
            max={trackClips.length}
            value={clipIndex + 1}
            onChange={(e) => {
              const requested = Number(e.target.value);
              if (Number.isNaN(requested)) return;
              const atIndex = Math.max(0, Math.min(trackClips.length - 1, requested - 1));
              dispatch({ type: "MOVE_CLIP", clipId: clip.id, trackId: clip.trackId, atIndex });
            }}
          />
        </label>
      )}

      {insertCandidates.length > 0 && (
        <label className="field">
          <span>Insert clip before this one</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) dispatch({ type: "ADD_CLIP", trackId: clip.trackId, sourceId: e.target.value, atIndex: clipIndex });
            }}
          >
            <option value="" disabled>
              Choose media…
            </option>
            {insertCandidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {insertCandidates.length > 0 && (
        <label className="field">
          <span>Insert clip after this one</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value)
                dispatch({ type: "ADD_CLIP", trackId: clip.trackId, sourceId: e.target.value, atIndex: clipIndex + 1 });
            }}
          >
            <option value="" disabled>
              Choose media…
            </option>
            {insertCandidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>Description</span>
        <textarea
          value={clip.label}
          placeholder={source?.name ?? "Untitled clip"}
          rows={3}
          onChange={(e) => update({ label: e.target.value })}
        />
      </label>

      {source?.kind !== "image" && (
        <>
          <label className="field checkbox-field">
            <input type="checkbox" checked={clip.muted} onChange={(e) => update({ muted: e.target.checked })} />
            <span>Mute</span>
          </label>

          <label className="field">
            <span>Volume — {Math.round(clip.volume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={clip.volume}
              disabled={clip.muted}
              onChange={(e) => update({ volume: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>
              Fade in{source?.kind === "video" ? " (from black)" : ""} — {clip.fadeInSeconds.toFixed(1)}s
            </span>
            <input
              type="range"
              min={0}
              max={maxFade}
              step={0.1}
              value={clip.fadeInSeconds}
              disabled={clip.muted && source?.kind !== "video"}
              onChange={(e) => update({ fadeInSeconds: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>
              Fade out{source?.kind === "video" ? " (to black)" : ""} — {clip.fadeOutSeconds.toFixed(1)}s
            </span>
            <input
              type="range"
              min={0}
              max={maxFade}
              step={0.1}
              value={clip.fadeOutSeconds}
              disabled={clip.muted && source?.kind !== "video"}
              onChange={(e) => update({ fadeOutSeconds: Number(e.target.value) })}
            />
          </label>
        </>
      )}

      {isVisual && (
        <>
          {source?.kind === "image" && (
            <label className="field">
              <span>Duration — {duration.toFixed(1)}s</span>
              <input
                type="range"
                min={0.5}
                max={30}
                step={0.5}
                value={duration}
                onChange={(e) => update({ outPoint: clip.inPoint + Number(e.target.value) * clip.speed })}
              />
            </label>
          )}

          <div className="field">
            <span>Frame fit</span>
            <div className="inline-fields">
              <button
                type="button"
                className={clip.fitMode === "fit" ? "active" : ""}
                title="Show the whole frame, with letterbox bars if the aspect ratio doesn't match"
                onClick={() => update({ fitMode: "fit" })}
              >
                Fit (letterbox)
              </button>
              <button
                type="button"
                className={clip.fitMode === "fill" ? "active" : ""}
                title="Fill the canvas edge-to-edge, cropping anything that doesn't fit"
                onClick={() => update({ fitMode: "fill" })}
              >
                Fill (crop)
              </button>
              <button
                type="button"
                className={clip.fitMode === "stretch" ? "active" : ""}
                title="Stretch width and height independently to exactly fill the canvas, distorting the image"
                onClick={() => update({ fitMode: "stretch" })}
              >
                Stretch
              </button>
            </div>
          </div>

          <label className="field">
            <span>Zoom — {clip.transform.scale.toFixed(2)}x</span>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.05}
              value={clip.transform.scale}
              onChange={(e) => updateTransform({ scale: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Pan X — {Math.round(clip.transform.x * 100)}</span>
            <input
              type="range"
              min={-0.4}
              max={0.4}
              step={0.01}
              value={clip.transform.x}
              onChange={(e) => updateTransform({ x: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Pan Y — {Math.round(clip.transform.y * 100)}</span>
            <input
              type="range"
              min={-0.4}
              max={0.4}
              step={0.01}
              value={clip.transform.y}
              onChange={(e) => updateTransform({ y: Number(e.target.value) })}
            />
          </label>

          <div className="field">
            <span>Filter</span>
            <div className="inline-fields inline-fields-wrap">
              {FILTER_PRESET_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={(clip.filter.preset ?? "none") === name ? "active" : ""}
                  onClick={() => applyPreset(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Brightness — {clip.filter.brightness > 0 ? "+" : ""}{Math.round(clip.filter.brightness * 100)}</span>
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.01}
              value={clip.filter.brightness}
              onChange={(e) => updateFilter({ brightness: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Contrast — {Math.round(clip.filter.contrast * 100)}%</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.01}
              value={clip.filter.contrast}
              onChange={(e) => updateFilter({ contrast: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Saturation — {Math.round(clip.filter.saturation * 100)}%</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={clip.filter.saturation}
              onChange={(e) => updateFilter({ saturation: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Hue — {clip.filter.hue}°</span>
            <input
              type="range"
              min={-30}
              max={30}
              step={1}
              value={clip.filter.hue}
              onChange={(e) => updateFilter({ hue: Number(e.target.value) })}
            />
          </label>

          {hasNextClip && (
            <div className="field">
              <span>Transition to next clip</span>
              <div className="inline-fields inline-fields-wrap">
                <button
                  type="button"
                  className={clip.transitionOutSeconds === 0 ? "active" : ""}
                  onClick={() => update({ transitionOutSeconds: 0 })}
                >
                  None (cut)
                </button>
                {TRANSITION_TYPE_NAMES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={clip.transitionOutSeconds > 0 && clip.transitionOutType === type ? "active" : ""}
                    onClick={() =>
                      update({ transitionOutSeconds: clip.transitionOutSeconds > 0 ? clip.transitionOutSeconds : 0.5, transitionOutType: type })
                    }
                  >
                    {TRANSITION_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasNextClip && clip.transitionOutSeconds > 0 && (
            <label className="field">
              <span>
                {TRANSITION_TYPE_LABELS[clip.transitionOutType]} duration — {clip.transitionOutSeconds.toFixed(1)}s
              </span>
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.1}
                value={clip.transitionOutSeconds}
                onChange={(e) => update({ transitionOutSeconds: Number(e.target.value) })}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
