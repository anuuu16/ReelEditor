import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { ClipFilter, FitMode } from "@reel-studio/shared-types";
import {
  ASPECT_RATIO_PRESETS,
  applyFilterPreset,
  NEUTRAL_FILTER,
  type FilterPresetName,
} from "@reel-studio/timeline-core";
import { saveImageToGallery } from "./persistence/db.js";
import { CropStage, FULL_CROP } from "./imageEditor/CropStage.js";
import { SliderField } from "./imageEditor/SliderField.js";
import {
  renderImage,
  type BackgroundMode,
  type CropRect,
  type ExtraAdjustments,
  type WatermarkPosition,
} from "./imageEditor/renderImage.js";

interface ImageEditorProps {
  onBack: () => void;
}

const FIT_MODES: Array<{ id: FitMode; label: string }> = [
  { id: "fit", label: "Fit" },
  { id: "fill", label: "Fill" },
  { id: "stretch", label: "Stretch" },
];

const SCALE_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const FILTER_PRESET_NAMES: FilterPresetName[] = ["none", "warm", "cool", "mono", "vintage"];
const CROP_ASPECTS: Array<{ label: string; ratio: number | null }> = [
  { label: "Free", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
];
const WATERMARK_POSITIONS: WatermarkPosition[] = ["top-left", "top-right", "center", "bottom-left", "bottom-right"];

const NEUTRAL_EXTRAS: ExtraAdjustments = { blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 1 };

type OutputFormat = "png" | "jpeg" | "webp";

const FORMAT_INFO: Record<OutputFormat, { label: string; mime: string; ext: string; lossy: boolean }> = {
  png: { label: "PNG", mime: "image/png", ext: "png", lossy: false },
  jpeg: { label: "JPEG", mime: "image/jpeg", ext: "jpg", lossy: true },
  webp: { label: "WebP", mime: "image/webp", ext: "webp", lossy: true },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Largest centered crop of the requested aspect ratio that fits inside the source image.
function cropForAspect(naturalWidth: number, naturalHeight: number, ratio: number): CropRect {
  const imageRatio = naturalWidth / naturalHeight;
  const width = imageRatio > ratio ? ratio / imageRatio : 1;
  const height = imageRatio > ratio ? 1 : imageRatio / ratio;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ie-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function ImageEditor({ onBack }: ImageEditorProps) {
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [fileBaseName, setFileBaseName] = useState("image");

  const [aspectId, setAspectId] = useState<string>("9:16");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1920);
  const [fitMode, setFitMode] = useState<FitMode>("fit");

  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [customRatioW, setCustomRatioW] = useState(1);
  const [customRatioH, setCustomRatioH] = useState(1);
  const [activeCropAspect, setActiveCropAspect] = useState<string>("Free");

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("solid");
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [backgroundBlur, setBackgroundBlur] = useState(24);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);

  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [fineRotationDeg, setFineRotationDeg] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const [filter, setFilter] = useState<ClipFilter>(NEUTRAL_FILTER);
  const [extras, setExtras] = useState<ExtraAdjustments>(NEUTRAL_EXTRAS);

  const [borderWidth, setBorderWidth] = useState(0);
  const [borderColor, setBorderColor] = useState("#ffffff");
  const [cornerRadius, setCornerRadius] = useState(0);

  const [watermarkText, setWatermarkText] = useState("");
  const [watermarkSize, setWatermarkSize] = useState(0.05);
  const [watermarkColor, setWatermarkColor] = useState("#ffffff");
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.8);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>("bottom-right");

  const [format, setFormat] = useState<OutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const croppedLongEdge = imageEl
    ? Math.max(imageEl.naturalWidth * crop.width, imageEl.naturalHeight * crop.height)
    : 0;
  const targetLongEdge = Math.max(width, height);
  const willUpscale = croppedLongEdge > 0 && targetLongEdge > croppedLongEdge;

  const flash = useCallback((message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 2200);
  }, []);

  const loadImageFile = useCallback((file: File, asBackground = false) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);
    const img = new Image();
    img.onload = () => {
      if (asBackground) {
        setBackgroundImage(img);
        setBackgroundMode("image");
        return;
      }
      setImageEl(img);
      setImageSrc(url);
      setCrop(FULL_CROP);
      setActiveCropAspect("Free");
      setFileBaseName(file.name.replace(/\.[^./]+$/, "") || "image");
    };
    img.src = url;
  }, []);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  // Paste an image straight from the clipboard, so a screenshot can go from copy to edit with no file step.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) loadImageFile(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadImageFile]);

  function applyPresetSize(preset: { id: string; width: number; height: number }) {
    setAspectId(preset.id);
    setWidth(preset.width);
    setHeight(preset.height);
  }

  // Scales the ORIGINAL image's own dimensions (not the current target frame) — a quick way to
  // upscale or downscale while keeping native proportions, separate from the fixed aspect frames.
  function applyScale(factor: number) {
    if (!imageEl) return;
    setAspectId("custom");
    setWidth(Math.max(1, Math.round(imageEl.naturalWidth * crop.width * factor)));
    setHeight(Math.max(1, Math.round(imageEl.naturalHeight * crop.height * factor)));
  }

  function matchCanvasToCrop() {
    if (!imageEl) return;
    setAspectId("custom");
    setWidth(Math.max(1, Math.round(imageEl.naturalWidth * crop.width)));
    setHeight(Math.max(1, Math.round(imageEl.naturalHeight * crop.height)));
  }

  function applyCropAspect(label: string, ratio: number | null) {
    setActiveCropAspect(label);
    if (!imageEl) return;
    setCrop(ratio == null ? FULL_CROP : cropForAspect(imageEl.naturalWidth, imageEl.naturalHeight, ratio));
  }

  function applyCustomCropRatio() {
    if (!imageEl || customRatioW <= 0 || customRatioH <= 0) return;
    setActiveCropAspect("custom");
    setCrop(cropForAspect(imageEl.naturalWidth, imageEl.naturalHeight, customRatioW / customRatioH));
  }

  function updateFilter(patch: Partial<ClipFilter>) {
    setFilter((f) => ({ ...f, preset: null, ...patch }));
  }

  function updateExtras(patch: Partial<ExtraAdjustments>) {
    setExtras((x) => ({ ...x, ...patch }));
  }

  function resetEverything() {
    setCrop(FULL_CROP);
    setActiveCropAspect("Free");
    setRotation(0);
    setFineRotationDeg(0);
    setFlipH(false);
    setFlipV(false);
    setFilter(NEUTRAL_FILTER);
    setExtras(NEUTRAL_EXTRAS);
    setBorderWidth(0);
    setCornerRadius(0);
    setWatermarkText("");
    setBackgroundMode("solid");
    setBackgroundColor("#000000");
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageEl) return;
    renderImage({
      canvas,
      image: imageEl,
      width,
      height,
      fitMode,
      crop,
      rotation,
      fineRotationDeg,
      flipH,
      flipV,
      filter,
      extras,
      backgroundMode,
      backgroundColor,
      backgroundBlur,
      backgroundImage,
      borderWidth,
      borderColor,
      cornerRadius,
      watermark: watermarkText.trim()
        ? { text: watermarkText, sizeRatio: watermarkSize, color: watermarkColor, opacity: watermarkOpacity, position: watermarkPosition }
        : null,
    });
  }, [
    imageEl,
    width,
    height,
    fitMode,
    crop,
    rotation,
    fineRotationDeg,
    flipH,
    flipV,
    filter,
    extras,
    backgroundMode,
    backgroundColor,
    backgroundBlur,
    backgroundImage,
    borderWidth,
    borderColor,
    cornerRadius,
    watermarkText,
    watermarkSize,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
  ]);

  // Estimating output size means actually encoding, so it's debounced. The deps deliberately mirror
  // the render effect (plus format/quality) so it re-runs when the drawn result changes — but never
  // on its own setEstimatedBytes, which would otherwise re-encode in a loop.
  useEffect(() => {
    if (!imageEl) return;
    const handle = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const info = FORMAT_INFO[format];
      canvas.toBlob((blob) => setEstimatedBytes(blob?.size ?? null), info.mime, info.lossy ? quality : undefined);
    }, 400);
    return () => clearTimeout(handle);
  }, [
    imageEl,
    format,
    quality,
    width,
    height,
    fitMode,
    crop,
    rotation,
    fineRotationDeg,
    flipH,
    flipV,
    filter,
    extras,
    backgroundMode,
    backgroundColor,
    backgroundBlur,
    backgroundImage,
    borderWidth,
    borderColor,
    cornerRadius,
    watermarkText,
    watermarkSize,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
  ]);

  function currentBlob(): Promise<Blob | null> {
    const canvas = canvasRef.current;
    if (!canvas) return Promise.resolve(null);
    const info = FORMAT_INFO[format];
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), info.mime, info.lossy ? quality : undefined));
  }

  function handleDownload() {
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
      const blob = await currentBlob();
      if (!blob) throw new Error("Nothing to copy");
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flash("Copied to clipboard");
    } catch (err) {
      console.error("Copy to clipboard failed", err);
      flash("Copy failed");
    }
  }

  async function handleSave() {
    try {
      const blob = await currentBlob();
      if (!blob) throw new Error("Nothing to save");
      await saveImageToGallery({
        id: crypto.randomUUID(),
        name: `${fileBaseName}-${width}x${height}`,
        blob,
        width,
        height,
        format: FORMAT_INFO[format].ext,
        savedAt: Date.now(),
      });
      flash("Saved — visible on the Dashboard");
    } catch (err) {
      console.error("Save failed", err);
      flash("Save failed");
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file) loadImageFile(file);
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button type="button" className="add-title-button" onClick={onBack} title="Back to Dashboard">
          ← Dashboard
        </button>
        <h1>Image Editor</h1>
        <div className="inline-fields">
          {status && <span className="ie-status">{status}</span>}
          <button type="button" onClick={handleSave} disabled={!imageEl}>
            Save
          </button>
          <button type="button" onClick={handleCopy} disabled={!imageEl}>
            Copy
          </button>
          <button type="button" className="ie-primary" onClick={handleDownload} disabled={!imageEl}>
            Download
          </button>
        </div>
      </header>

      <div className="ie-body">
        <div className="ie-controls">
          <Section title="Source">
            <label className="field">
              <span>Image file</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadImageFile(file);
                }}
              />
            </label>
            <p className="hint">You can also drop an image on the preview, or paste one from the clipboard.</p>
            {imageEl && (
              <p className="hint">
                Original: {imageEl.naturalWidth}×{imageEl.naturalHeight}
              </p>
            )}
          </Section>

          {imageEl && (
            <Section title="Crop">
              <CropStage src={imageSrc} crop={crop} onChange={setCrop} />
              <div className="inline-fields inline-fields-wrap">
                {CROP_ASPECTS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={activeCropAspect === option.label ? "active" : ""}
                    onClick={() => applyCropAspect(option.label, option.ratio)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="field">
                <span>Custom ratio</span>
                <div className="inline-fields">
                  <input
                    type="number"
                    min={1}
                    className="ie-ratio-input"
                    value={customRatioW}
                    onChange={(e) => setCustomRatioW(Math.max(1, Number(e.target.value)))}
                  />
                  <span>:</span>
                  <input
                    type="number"
                    min={1}
                    className="ie-ratio-input"
                    value={customRatioH}
                    onChange={(e) => setCustomRatioH(Math.max(1, Number(e.target.value)))}
                  />
                  <button type="button" className={activeCropAspect === "custom" ? "active" : ""} onClick={applyCustomCropRatio}>
                    Apply
                  </button>
                </div>
              </div>
              <div className="inline-fields inline-fields-wrap">
                <button type="button" onClick={matchCanvasToCrop}>
                  Set output size to crop
                </button>
              </div>
            </Section>
          )}

          <Section title="Output size">
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
              <span>Scale source</span>
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
                Source is ~{Math.round(croppedLongEdge)}px on its long side — {targetLongEdge}px will upscale it and may look soft.
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
          </Section>

          <Section title="Transform">
            <div className="inline-fields inline-fields-wrap">
              <button type="button" onClick={() => setRotation((r) => ((r + 270) % 360) as 0 | 90 | 180 | 270)}>
                ↺ Left 90°
              </button>
              <button type="button" onClick={() => setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)}>
                ↻ Right 90°
              </button>
              <button type="button" className={flipH ? "active" : ""} onClick={() => setFlipH((v) => !v)}>
                ⇋ Flip H
              </button>
              <button type="button" className={flipV ? "active" : ""} onClick={() => setFlipV((v) => !v)}>
                ⇵ Flip V
              </button>
            </div>
            <SliderField
              label="Straighten"
              value={fineRotationDeg}
              min={-45}
              max={45}
              step={0.5}
              onChange={setFineRotationDeg}
              format={(v) => `${v.toFixed(1)}°`}
            />
          </Section>
        </div>

        <div
          className={`ie-preview${isDragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          {!imageEl && <p className="hint">Choose, drop, or paste an image to start editing.</p>}
          <canvas ref={canvasRef} className="ie-canvas" style={{ display: imageEl ? "block" : "none" }} />
        </div>

        <div className="ie-controls">
          <Section title="Background fill">
            <p className="hint">Shows wherever the image doesn't fill the frame (Fit mode, or any transparent area).</p>
            <div className="inline-fields">
              <button type="button" className={backgroundMode === "solid" ? "active" : ""} onClick={() => setBackgroundMode("solid")}>
                Solid
              </button>
              <button type="button" className={backgroundMode === "blur" ? "active" : ""} onClick={() => setBackgroundMode("blur")}>
                Blurred photo
              </button>
              <button type="button" className={backgroundMode === "image" ? "active" : ""} onClick={() => setBackgroundMode("image")}>
                Another image
              </button>
            </div>

            <label className="field">
              <span>Base color</span>
              <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} />
            </label>

            {backgroundMode === "blur" && (
              <SliderField label="Blur amount" value={backgroundBlur} min={0} max={80} step={1} onChange={setBackgroundBlur} format={(v) => `${v}px`} />
            )}

            {backgroundMode === "image" && (
              <label className="field">
                <span>Background image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) loadImageFile(file, true);
                  }}
                />
              </label>
            )}
          </Section>

          <Section title="Adjustments">
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

            <SliderField
              label="Brightness"
              value={filter.brightness}
              min={-0.5}
              max={0.5}
              step={0.01}
              onChange={(v) => updateFilter({ brightness: v })}
              format={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`}
            />
            <SliderField
              label="Contrast"
              value={filter.contrast}
              min={0.5}
              max={1.5}
              step={0.01}
              onChange={(v) => updateFilter({ contrast: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderField
              label="Saturation"
              value={filter.saturation}
              min={0}
              max={2}
              step={0.01}
              onChange={(v) => updateFilter({ saturation: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderField label="Hue" value={filter.hue} min={-180} max={180} step={1} onChange={(v) => updateFilter({ hue: v })} format={(v) => `${v}°`} />
            <SliderField label="Blur" value={extras.blur} min={0} max={20} step={0.5} onChange={(v) => updateExtras({ blur: v })} format={(v) => `${v}px`} />
            <SliderField
              label="Sepia"
              value={extras.sepia}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateExtras({ sepia: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderField
              label="Grayscale"
              value={extras.grayscale}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateExtras({ grayscale: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderField
              label="Invert"
              value={extras.invert}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateExtras({ invert: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderField
              label="Opacity"
              value={extras.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateExtras({ opacity: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Section>

          <Section title="Frame">
            <SliderField label="Border width" value={borderWidth} min={0} max={80} step={1} onChange={setBorderWidth} format={(v) => `${v}px`} />
            <label className="field">
              <span>Border color</span>
              <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} />
            </label>
            <SliderField label="Corner radius" value={cornerRadius} min={0} max={100} step={1} onChange={setCornerRadius} format={(v) => `${v}%`} />
          </Section>

          <Section title="Watermark">
            <label className="field">
              <span>Text</span>
              <input type="text" value={watermarkText} placeholder="© Your name" onChange={(e) => setWatermarkText(e.target.value)} />
            </label>
            {watermarkText.trim() && (
              <>
                <div className="field">
                  <span>Position</span>
                  <div className="inline-fields inline-fields-wrap">
                    {WATERMARK_POSITIONS.map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        className={watermarkPosition === pos ? "active" : ""}
                        onClick={() => setWatermarkPosition(pos)}
                      >
                        {pos.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                </div>
                <SliderField
                  label="Size"
                  value={watermarkSize}
                  min={0.02}
                  max={0.2}
                  step={0.005}
                  onChange={setWatermarkSize}
                  format={(v) => `${Math.round(v * 100)}% of width`}
                />
                <label className="field">
                  <span>Color</span>
                  <input type="color" value={watermarkColor} onChange={(e) => setWatermarkColor(e.target.value)} />
                </label>
                <SliderField
                  label="Opacity"
                  value={watermarkOpacity}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onChange={setWatermarkOpacity}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </>
            )}
          </Section>

          <Section title="Export">
            <div className="inline-fields">
              {(Object.keys(FORMAT_INFO) as OutputFormat[]).map((id) => (
                <button key={id} type="button" className={format === id ? "active" : ""} onClick={() => setFormat(id)}>
                  {FORMAT_INFO[id].label}
                </button>
              ))}
            </div>
            {FORMAT_INFO[format].lossy && (
              <SliderField label="Quality" value={quality} min={0.1} max={1} step={0.01} onChange={setQuality} format={(v) => `${Math.round(v * 100)}%`} />
            )}
            <p className="hint">
              Output: {width}×{height} {FORMAT_INFO[format].label}
              {estimatedBytes != null && ` · ~${formatBytes(estimatedBytes)}`}
            </p>
            <div className="inline-fields inline-fields-wrap">
              <button type="button" onClick={resetEverything}>
                Reset all edits
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
