import type { Overlay, OverlayAnimation } from "@reel-studio/shared-types";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { loadBrandKit } from "../persistence/brandKit.js";

const POSITION_PRESETS: Array<{ label: string; x: number; y: number }> = [
  { label: "Top left", x: 0.15, y: 0.15 },
  { label: "Top", x: 0.5, y: 0.15 },
  { label: "Top right", x: 0.85, y: 0.15 },
  { label: "Center", x: 0.5, y: 0.5 },
  { label: "Bottom left", x: 0.15, y: 0.88 },
  { label: "Bottom", x: 0.5, y: 0.85 },
  { label: "Bottom right", x: 0.85, y: 0.88 },
];

export function OverlayInspector() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const overlay = state.project.overlays.find((o) => o.id === state.selectedOverlayId) ?? null;
  const imageSource =
    overlay?.kind === "image" ? state.project.sources.find((s) => s.id === overlay.imageSourceId) : undefined;

  if (!overlay) return null;

  function update(patch: Partial<Overlay>) {
    dispatch({ type: "UPDATE_OVERLAY", overlayId: overlay!.id, patch });
  }

  function updateStyle(patch: Partial<Overlay["style"]>) {
    update({ style: { ...overlay!.style, ...patch } });
  }

  return (
    <div className="clip-inspector">
      <h2>{overlay.kind === "image" ? "Logo / image" : "Title"}</h2>

      {overlay.kind === "image" && (
        <div className="clip-preview-thumb">{imageSource && <img src={imageSource.previewUrl} alt="" />}</div>
      )}

      {overlay.kind === "text" && (
        <label className="field">
          <span>Text</span>
          <textarea value={overlay.content} rows={2} onChange={(e) => update({ content: e.target.value })} />
        </label>
      )}

      <label className="field">
        <span>
          Start — {overlay.start.toFixed(1)}s / End — {overlay.end.toFixed(1)}s
        </span>
        <div className="inline-fields">
          <input
            type="number"
            min={0}
            step={0.1}
            value={overlay.start.toFixed(1)}
            onChange={(e) => update({ start: Math.max(0, Math.min(Number(e.target.value), overlay.end - 0.1)) })}
          />
          <input
            type="number"
            min={0}
            step={0.1}
            value={overlay.end.toFixed(1)}
            onChange={(e) => update({ end: Math.max(overlay.start + 0.1, Number(e.target.value)) })}
          />
        </div>
      </label>

      <div className="field">
        <span>Position — or drag it directly in the preview</span>
        <div className="inline-fields inline-fields-wrap">
          {POSITION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={overlay.position.x === preset.x && overlay.position.y === preset.y ? "active" : ""}
              onClick={() => update({ position: { x: preset.x, y: preset.y } })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {overlay.kind === "image" && (
        <>
          <p className="hint">Drag the logo to move it, or drag its bottom-right handle to resize — or set exact ratios below.</p>
          <label className="field">
            <span>Width — {Math.round(overlay.widthRatio * 100)}% of frame width</span>
            <input
              type="range"
              min={0.02}
              max={1}
              step={0.01}
              value={overlay.widthRatio}
              onChange={(e) => update({ widthRatio: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Height — {Math.round(overlay.heightRatio * 100)}% of frame height</span>
            <input
              type="range"
              min={0.02}
              max={1}
              step={0.01}
              value={overlay.heightRatio}
              onChange={(e) => update({ heightRatio: Number(e.target.value) })}
            />
          </label>
        </>
      )}

      {overlay.kind === "text" && (
        <>
          <label className="field">
            <span>Font size — {overlay.style.size}px</span>
            <input
              type="range"
              min={16}
              max={120}
              step={1}
              value={overlay.style.size}
              onChange={(e) => updateStyle({ size: Number(e.target.value) })}
            />
          </label>

          <div className="field">
            <span>Alignment</span>
            <div className="inline-fields">
              {(["left", "center", "right"] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  className={overlay.style.align === align ? "active" : ""}
                  onClick={() => updateStyle({ align })}
                >
                  {align}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Text color</span>
            <div className="inline-fields">
              <input type="color" value={overlay.style.color} onChange={(e) => updateStyle({ color: e.target.value })} />
              <button type="button" title="Use brand primary color" onClick={() => updateStyle({ color: loadBrandKit().primaryColor })}>
                Primary
              </button>
              <button
                type="button"
                title="Use brand secondary color"
                onClick={() => updateStyle({ color: loadBrandKit().secondaryColor })}
              >
                Secondary
              </button>
            </div>
          </label>

          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={overlay.style.background !== null}
              onChange={(e) => updateStyle({ background: e.target.checked ? "#000000" : null })}
            />
            <span>Background</span>
            {overlay.style.background !== null && (
              <input type="color" value={overlay.style.background} onChange={(e) => updateStyle({ background: e.target.value })} />
            )}
          </label>

          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={overlay.style.outline !== null}
              onChange={(e) => updateStyle({ outline: e.target.checked ? "#000000" : null })}
            />
            <span>Outline</span>
            {overlay.style.outline !== null && (
              <input type="color" value={overlay.style.outline} onChange={(e) => updateStyle({ outline: e.target.value })} />
            )}
          </label>
        </>
      )}

      <label className="field">
        <span>Animation</span>
        <select value={overlay.animation} onChange={(e) => update({ animation: e.target.value as OverlayAnimation })}>
          <option value="none">None</option>
          <option value="fade">Fade</option>
          {overlay.kind === "text" && <option value="slide-in">Slide in</option>}
          {overlay.kind === "text" && <option value="pop">Pop</option>}
        </select>
      </label>

      <button type="button" onClick={() => dispatch({ type: "REMOVE_OVERLAY", overlayId: overlay.id })}>
        Remove {overlay.kind === "image" ? "logo" : "title"}
      </button>
    </div>
  );
}
