import { useEffect, useRef, useState } from "react";
import type { ClipFilter, FitMode } from "@reel-studio/shared-types";
import {
  ASPECT_RATIO_PRESETS,
  applyFilterPreset,
  buildCanvasFilterString,
  computeFitRect,
  NEUTRAL_FILTER,
  type FilterPresetName,
} from "@reel-studio/timeline-core";

interface ImageEditorProps {
  onBack: () => void;
}

const FIT_MODES: Array<{ id: FitMode; label: string }> = [
  { id: "fit", label: "Fit (letterbox)" },
  { id: "fill", label: "Fill (crop)" },
  { id: "stretch", label: "Stretch" },
];

const SCALE_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const FILTER_PRESET_NAMES: FilterPresetName[] = ["none", "warm", "cool", "mono", "vintage"];

type OutputFormat = "png" | "jpeg" | "webp";

const FORMAT_INFO: Record<OutputFormat, { label: string; mime: string; ext: string; lossy: boolean }> = {
  png: { label: "PNG (lossless)", mime: "image/png", ext: "png", lossy: false },
  jpeg: { label: "JPEG", mime: "image/jpeg", ext: "jpg", lossy: true },
  webp: { label: "WebP", mime: "image/webp", ext: "webp", lossy: true },
};

export function ImageEditor({ onBack }: ImageEditorProps) {
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [fileBaseName, setFileBaseName] = useState("image");
  const [aspectId, setAspectId] = useState<string>("9:16");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1920);
  const [fitMode, setFitMode] = useState<FitMode>("fit");
  const [background, setBackground] = useState("#000000");
  const [format, setFormat] = useState<OutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [filter, setFilter] = useState<ClipFilter>(NEUTRAL_FILTER);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastUrlRef = useRef<string | null>(null);

  const sourceLongEdge = imageEl ? Math.max(imageEl.naturalWidth, imageEl.naturalHeight) : 0;
  const targetLongEdge = Math.max(width, height);
  const willUpscale = sourceLongEdge > 0 && targetLongEdge > sourceLongEdge;

  function handleFile(file: File) {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    const url = URL.createObjectURL(file);
    lastUrlRef.current = url;
    setFileBaseName(file.name.replace(/\.[^./]+$/, "") || "image");
    const img = new Image();
    img.onload = () => setImageEl(img);
    img.src = url;
  }

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
  }, []);

  function applyPresetSize(preset: { id: string; width: number; height: number }) {
    setAspectId(preset.id);
    setWidth(preset.width);
    setHeight(preset.height);
  }

  // Scales the ORIGINAL image's own dimensions (not the current target frame) — a quick way to
  // upscale or downscale a picture while keeping its native proportions, separate from fitting it
  // into one of the fixed aspect-ratio frames above.
  function applyScale(factor: number) {
    if (!imageEl) return;
    setAspectId("custom");
    setWidth(Math.max(1, Math.round(imageEl.naturalWidth * factor)));
    setHeight(Math.max(1, Math.round(imageEl.naturalHeight * factor)));
  }

  function updateFilter(patch: Partial<ClipFilter>) {
    setFilter((f) => ({ ...f, preset: null, ...patch }));
  }

  function resetAdjustments() {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setFilter(NEUTRAL_FILTER);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageEl) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const rotatedQuarter = rotation === 90 || rotation === 270;
    const sourceW = rotatedQuarter ? imageEl.naturalHeight : imageEl.naturalWidth;
    const sourceH = rotatedQuarter ? imageEl.naturalWidth : imageEl.naturalHeight;
    const rect = computeFitRect(width, height, sourceW, sourceH, fitMode);
    // The image is drawn in its own (pre-rotation) orientation, then rotated/flipped around the
    // fitted rect's center — so a 90°-rotated draw size is the rect's dimensions swapped back.
    const drawW = rotatedQuarter ? rect.height : rect.width;
    const drawH = rotatedQuarter ? rect.width : rect.height;

    ctx.save();
    ctx.filter = buildCanvasFilterString(filter);
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(imageEl, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }, [imageEl, width, height, fitMode, background, filter, rotation, flipH, flipV]);

  function toBlob(): Promise<Blob | null> {
    const canvas = canvasRef.current;
    if (!canvas) return Promise.resolve(null);
    const info = FORMAT_INFO[format];
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), info.mime, info.lossy ? quality : undefined));
  }

  async function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const info = FORMAT_INFO[format];
    const link = document.createElement("a");
    link.download = `${fileBaseName}-${width}x${height}.${info.ext}`;
    link.href = info.lossy ? canvas.toDataURL(info.mime, quality) : canvas.toDataURL(info.mime);
    link.click();
  }

  async function handleCopy() {
    try {
      const blob = await toBlob();
      if (!blob) throw new Error("Nothing to copy");
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopyStatus("copied");
    } catch (err) {
      console.error("Copy to clipboard failed", err);
      setCopyStatus("error");
    } finally {
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button type="button" className="add-title-button" onClick={onBack} title="Back to Dashboard">
          ← Dashboard
        </button>
        <h1>Image Editor</h1>
      </header>

      <div className="resizer-body">
        <div className="resizer-controls">
          <label className="field">
            <span>Image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>

          <div className="field">
            <span>Aspect ratio</span>
            <div className="inline-fields inline-fields-wrap">
              {ASPECT_RATIO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={aspectId === preset.id ? "active" : ""}
                  onClick={() => applyPresetSize(preset)}
                >
                  {preset.id}
                </button>
              ))}
              <button type="button" className={aspectId === "custom" ? "active" : ""} onClick={() => setAspectId("custom")}>
                Custom
              </button>
            </div>
          </div>

          <div className="inline-fields">
            <label className="field">
              <span>Width</span>
              <input
                type="number"
                min={1}
                value={width}
                onChange={(e) => {
                  setAspectId("custom");
                  setWidth(Math.max(1, Number(e.target.value)));
                }}
              />
            </label>
            <label className="field">
              <span>Height</span>
              <input
                type="number"
                min={1}
                value={height}
                onChange={(e) => {
                  setAspectId("custom");
                  setHeight(Math.max(1, Number(e.target.value)));
                }}
              />
            </label>
          </div>

          <div className="field">
            <span>Scale original (up or down)</span>
            <div className="inline-fields inline-fields-wrap">
              {SCALE_PRESETS.map((factor) => (
                <button key={factor} type="button" disabled={!imageEl} onClick={() => applyScale(factor)}>
                  {Math.round(factor * 100)}%
                </button>
              ))}
            </div>
          </div>

          {willUpscale && (
            <p className="export-warning">
              This image is natively ~{sourceLongEdge}px on its long side — {targetLongEdge}px will upscale it and may look soft.
            </p>
          )}

          <div className="field">
            <span>Fit mode</span>
            <div className="inline-fields">
              {FIT_MODES.map((mode) => (
                <button key={mode.id} type="button" className={fitMode === mode.id ? "active" : ""} onClick={() => setFitMode(mode.id)}>
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {fitMode === "fit" && (
            <label className="field">
              <span>Letterbox color</span>
              <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
            </label>
          )}

          <div className="field">
            <span>Rotate &amp; flip</span>
            <div className="inline-fields inline-fields-wrap">
              <button type="button" onClick={() => setRotation((r) => ((r + 270) % 360) as 0 | 90 | 180 | 270)}>
                ↺ Rotate left
              </button>
              <button type="button" onClick={() => setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)}>
                ↻ Rotate right
              </button>
              <button type="button" className={flipH ? "active" : ""} onClick={() => setFlipH((v) => !v)}>
                ⇋ Flip horizontal
              </button>
              <button type="button" className={flipV ? "active" : ""} onClick={() => setFlipV((v) => !v)}>
                ⇵ Flip vertical
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
                  className={(filter.preset ?? "none") === name ? "active" : ""}
                  onClick={() => setFilter(applyFilterPreset(name))}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>
              Brightness — {filter.brightness > 0 ? "+" : ""}
              {Math.round(filter.brightness * 100)}
            </span>
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.01}
              value={filter.brightness}
              onChange={(e) => updateFilter({ brightness: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Contrast — {Math.round(filter.contrast * 100)}%</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.01}
              value={filter.contrast}
              onChange={(e) => updateFilter({ contrast: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Saturation — {Math.round(filter.saturation * 100)}%</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={filter.saturation}
              onChange={(e) => updateFilter({ saturation: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Hue — {filter.hue}°</span>
            <input type="range" min={-30} max={30} step={1} value={filter.hue} onChange={(e) => updateFilter({ hue: Number(e.target.value) })} />
          </label>

          <div className="field">
            <button type="button" onClick={resetAdjustments}>
              Reset rotate/flip/filter
            </button>
          </div>

          <div className="field">
            <span>Format</span>
            <div className="inline-fields">
              {(Object.keys(FORMAT_INFO) as OutputFormat[]).map((id) => (
                <button key={id} type="button" className={format === id ? "active" : ""} onClick={() => setFormat(id)}>
                  {FORMAT_INFO[id].label}
                </button>
              ))}
            </div>
          </div>

          {FORMAT_INFO[format].lossy && (
            <label className="field">
              <span>Quality — {Math.round(quality * 100)}%</span>
              <input type="range" min={0.1} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            </label>
          )}

          <button type="button" onClick={handleDownload} disabled={!imageEl}>
            Download {width}×{height} {format.toUpperCase()}
          </button>
          <button type="button" onClick={handleCopy} disabled={!imageEl}>
            {copyStatus === "copied" ? "Copied!" : copyStatus === "error" ? "Copy failed" : "Copy to clipboard"}
          </button>
        </div>

        <div className="resizer-preview">
          {!imageEl && <p className="hint">Choose an image to preview it here.</p>}
          <canvas ref={canvasRef} className="resizer-canvas" style={{ display: imageEl ? "block" : "none" }} />
        </div>
      </div>
    </div>
  );
}
