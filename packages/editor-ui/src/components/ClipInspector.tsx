import { useEffect, useState } from "react";
import type { Clip } from "@reel-studio/shared-types";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";

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

  if (!clip) {
    return (
      <div className="clip-inspector">
        <h2>Clip</h2>
        <p className="hint">Select a clip on the timeline to edit it.</p>
      </div>
    );
  }

  const duration = (clip.outPoint - clip.inPoint) / clip.speed;
  const maxFade = Math.max(duration / 2, 0.1);

  function update(patch: Partial<Clip>) {
    dispatch({ type: "UPDATE_CLIP", clipId: clip!.id, patch });
  }

  return (
    <div className="clip-inspector">
      <h2>Clip</h2>

      <div className={`clip-preview-thumb${source?.kind === "audio" ? " clip-preview-thumb-audio" : ""}`}>
        {thumbnail && <img src={thumbnail} alt="" />}
        {source?.kind === "audio" && <span>Audio</span>}
      </div>

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
        <span>Fade in — {clip.fadeInSeconds.toFixed(1)}s</span>
        <input
          type="range"
          min={0}
          max={maxFade}
          step={0.1}
          value={clip.fadeInSeconds}
          disabled={clip.muted}
          onChange={(e) => update({ fadeInSeconds: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Fade out — {clip.fadeOutSeconds.toFixed(1)}s</span>
        <input
          type="range"
          min={0}
          max={maxFade}
          step={0.1}
          value={clip.fadeOutSeconds}
          disabled={clip.muted}
          onChange={(e) => update({ fadeOutSeconds: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
