import { useEffect, useState } from "react";
import type { Clip, ClipFilter } from "@reel-studio/shared-types";
import { applyFilterPreset, type FilterPresetName } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";

const FILTER_PRESET_NAMES: FilterPresetName[] = ["none", "warm", "cool", "mono", "vintage"];

export function ClipInspector() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const clip = state.project.clips.find((c) => c.id === state.selectedClipId) ?? null;
  const source = clip ? state.project.sources.find((s) => s.id === clip.sourceId) : undefined;
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    setThumbnail(null);
    if (!clip || source?.kind !== "video") return;
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
  const replaceCandidates = state.project.sources.filter((s) => s.kind === source?.kind && s.id !== clip.sourceId);

  function update(patch: Partial<Clip>) {
    dispatch({ type: "UPDATE_CLIP", clipId: clip!.id, patch });
  }

  function updateFilter(patch: Partial<ClipFilter>) {
    update({ filter: { ...clip!.filter, preset: null, ...patch } });
  }

  function applyPreset(name: FilterPresetName) {
    update({ filter: applyFilterPreset(name) });
  }

  return (
    <div className="clip-inspector">
      <h2>Clip</h2>

      <div className={`clip-preview-thumb${source?.kind === "audio" ? " clip-preview-thumb-audio" : ""}`}>
        {thumbnail && <img src={thumbnail} alt="" />}
        {source?.kind === "audio" && <span>Audio</span>}
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

      <label className="field">
        <span>Description</span>
        <textarea
          value={clip.label}
          placeholder={source?.name ?? "Untitled clip"}
          rows={3}
          onChange={(e) => update({ label: e.target.value })}
        />
      </label>

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
        <span>Fade in{source?.kind === "video" ? " (from black)" : ""} — {clip.fadeInSeconds.toFixed(1)}s</span>
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
        <span>Fade out{source?.kind === "video" ? " (to black)" : ""} — {clip.fadeOutSeconds.toFixed(1)}s</span>
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

      {source?.kind === "video" && (
        <>
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
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}
