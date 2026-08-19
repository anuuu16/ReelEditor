import { useEffect, useRef, useState } from "react";
import type { FitMode } from "@reel-studio/shared-types";
import { ASPECT_RATIO_PRESETS, computeFitRect } from "@reel-studio/timeline-core";

interface ImageResizerProps {
  onBack: () => void;
}

const FIT_MODES: Array<{ id: FitMode; label: string }> = [
  { id: "fit", label: "Fit (letterbox)" },
  { id: "fill", label: "Fill (crop)" },
  { id: "stretch", label: "Stretch" },
];

const SCALE_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

type OutputFormat = "png" | "jpeg";

export function ImageResizer({ onBack }: ImageResizerProps) {
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [fileBaseName, setFileBaseName] = useState("image");
  const [aspectId, setAspectId] = useState<string>("9:16");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1920);
  const [fitMode, setFitMode] = useState<FitMode>("fit");
  const [background, setBackground] = useState("#000000");
  const [format, setFormat] = useState<OutputFormat>("png");
  const [jpegQuality, setJpegQuality] = useState(0.9);
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

  function applyPreset(preset: { id: string; width: number; height: number }) {
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageEl) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    const rect = computeFitRect(width, height, imageEl.naturalWidth, imageEl.naturalHeight, fitMode);
    ctx.drawImage(imageEl, rect.x, rect.y, rect.width, rect.height);
  }, [imageEl, width, height, fitMode, background]);

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    const extension = format === "jpeg" ? "jpg" : "png";
    link.download = `${fileBaseName}-${width}x${height}.${extension}`;
    link.href = format === "jpeg" ? canvas.toDataURL("image/jpeg", jpegQuality) : canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button type="button" className="add-title-button" onClick={onBack} title="Back to Dashboard">
          ← Dashboard
        </button>
        <h1>Image Resizer</h1>
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
                  onClick={() => applyPreset(preset)}
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
            <span>Format</span>
            <div className="inline-fields">
              <button type="button" className={format === "png" ? "active" : ""} onClick={() => setFormat("png")}>
                PNG (lossless)
              </button>
              <button type="button" className={format === "jpeg" ? "active" : ""} onClick={() => setFormat("jpeg")}>
                JPEG (adjustable quality)
              </button>
            </div>
          </div>

          {format === "jpeg" && (
            <label className="field">
              <span>Quality — {Math.round(jpegQuality * 100)}%</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.01}
                value={jpegQuality}
                onChange={(e) => setJpegQuality(Number(e.target.value))}
              />
            </label>
          )}

          <button type="button" onClick={handleDownload} disabled={!imageEl}>
            Download {width}×{height} {format.toUpperCase()}
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
