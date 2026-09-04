import { useMemo, useState } from "react";
import type { TransitionType } from "@reel-studio/shared-types";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";

const TRANSITION_OPTIONS: { value: TransitionType | "none"; label: string }[] = [
  { value: "none", label: "None (hard cut)" },
  { value: "dissolve", label: "Dissolve" },
  { value: "slide", label: "Slide" },
  { value: "wipe", label: "Wipe" },
  { value: "zoom", label: "Zoom" },
];

const DEFAULT_SECONDS = 4;
const MIN_SECONDS = 0.5;
const MAX_SECONDS = 20;

interface SlideshowDialogProps {
  onClose: () => void;
}

export function SlideshowDialog({ onClose }: SlideshowDialogProps) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  const images = useMemo(
    () => state.project.sources.filter((s) => s.kind === "image" && !s.isPlaceholder),
    [state.project.sources]
  );
  const audioSources = useMemo(
    () => state.project.sources.filter((s) => s.kind === "audio" && !s.isPlaceholder),
    [state.project.sources]
  );

  const [order, setOrder] = useState<string[]>(() => images.map((s) => s.id));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(images.map((s) => s.id)));
  const [durations, setDurations] = useState<Record<string, number>>(() =>
    Object.fromEntries(images.map((s) => [s.id, DEFAULT_SECONDS]))
  );
  const [applyAll, setApplyAll] = useState(DEFAULT_SECONDS);
  const [transition, setTransition] = useState<TransitionType | "none">("dissolve");
  const [transitionSeconds, setTransitionSeconds] = useState(0.5);
  const [musicId, setMusicId] = useState("");
  const [fitToMusic, setFitToMusic] = useState(false);
  const [replace, setReplace] = useState(true);

  const nameById = new Map(state.project.sources.map((s) => [s.id, s.name]));
  const chosen = order.filter((id) => selected.has(id));
  const music = state.project.sources.find((s) => s.id === musicId);
  const canFitToMusic = !!music && chosen.length > 0;
  const fitSeconds = canFitToMusic ? music!.durationSeconds / chosen.length : DEFAULT_SECONDS;

  function durationFor(id: string): number {
    if (fitToMusic && canFitToMusic) return fitSeconds;
    return durations[id] ?? DEFAULT_SECONDS;
  }

  function setDuration(id: string, seconds: number) {
    setDurations((prev) => ({ ...prev, [id]: seconds }));
  }

  function move(id: string, delta: number) {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function create() {
    if (chosen.length === 0) return;
    dispatch({
      type: "CREATE_SLIDESHOW",
      imageSourceIds: chosen,
      perImageSeconds: chosen.map((id) => durationFor(id)),
      transitionType: transition === "none" ? "dissolve" : transition,
      transitionSeconds: transition === "none" ? 0 : transitionSeconds,
      musicSourceId: musicId || null,
      replaceVideoTrack: replace,
    });
    onClose();
  }

  const totalSeconds = chosen.reduce((sum, id) => sum + durationFor(id), 0);
  const durationsLocked = fitToMusic && canFitToMusic;

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="slideshow-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="export-close" onClick={onClose} title="Close">
          ×
        </button>
        <h2>Create slideshow</h2>

        <div className="field">
          <span>Images ({chosen.length} selected) — drag each slider to set its time</span>
          <ul className="slideshow-image-list">
            {order.map((id, i) => (
              <li key={id} className={selected.has(id) ? "" : "excluded"}>
                <label className="slideshow-image-head">
                  <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
                  <span className="slideshow-image-name">{nameById.get(id) ?? id}</span>
                  <span className="slideshow-image-secs">{durationFor(id).toFixed(1)}s</span>
                </label>
                <div className="slideshow-image-row">
                  <input
                    type="range"
                    min={MIN_SECONDS}
                    max={MAX_SECONDS}
                    step={0.5}
                    value={Math.min(MAX_SECONDS, durationFor(id))}
                    disabled={durationsLocked || !selected.has(id)}
                    onChange={(e) => setDuration(id, Number(e.target.value))}
                  />
                  <span className="slideshow-reorder">
                    <button type="button" disabled={i === 0} onClick={() => move(id, -1)} title="Move up">
                      ▲
                    </button>
                    <button type="button" disabled={i === order.length - 1} onClick={() => move(id, 1)} title="Move down">
                      ▼
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="field">
          <span>Set all to — {applyAll.toFixed(1)}s</span>
          <div className="slideshow-image-row">
            <input
              type="range"
              min={MIN_SECONDS}
              max={MAX_SECONDS}
              step={0.5}
              value={applyAll}
              disabled={durationsLocked}
              onChange={(e) => setApplyAll(Number(e.target.value))}
            />
            <button
              type="button"
              className="slideshow-apply-all"
              disabled={durationsLocked}
              onClick={() => setDurations(Object.fromEntries(order.map((id) => [id, applyAll])))}
            >
              Apply
            </button>
          </div>
        </div>

        <label className="field">
          <span>Transition between images</span>
          <select value={transition} onChange={(e) => setTransition(e.target.value as TransitionType | "none")}>
            {TRANSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {transition !== "none" && (
          <label className="field">
            <span>Transition duration — {transitionSeconds.toFixed(1)}s</span>
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={transitionSeconds}
              onChange={(e) => setTransitionSeconds(Number(e.target.value))}
            />
          </label>
        )}

        <label className="field">
          <span>Music</span>
          <select value={musicId} onChange={(e) => setMusicId(e.target.value)}>
            <option value="">None</option>
            {audioSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {music && (
          <label className="slideshow-check">
            <input type="checkbox" checked={fitToMusic} onChange={(e) => setFitToMusic(e.target.checked)} />
            <span>
              Fit all images evenly to music length ({music.durationSeconds.toFixed(1)}s ÷ {chosen.length || 1} ={" "}
              {fitSeconds.toFixed(1)}s each)
            </span>
          </label>
        )}

        <div className="field">
          <span>Video track</span>
          <div className="inline-fields">
            <button type="button" className={replace ? "active" : ""} onClick={() => setReplace(true)}>
              Replace
            </button>
            <button type="button" className={!replace ? "active" : ""} onClick={() => setReplace(false)}>
              Append
            </button>
          </div>
        </div>

        <p className="hint">
          {chosen.length === 0
            ? "Select at least one image."
            : `${chosen.length} image${chosen.length === 1 ? "" : "s"} · about ${totalSeconds.toFixed(1)}s total`}
        </p>

        <div className="slideshow-actions">
          <button type="button" className="slideshow-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={create} disabled={chosen.length === 0}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
