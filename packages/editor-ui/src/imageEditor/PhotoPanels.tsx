import type { ClipFilter } from "@reel-studio/shared-types";
import { applyFilterPreset, type FilterPresetName } from "@reel-studio/timeline-core";
import { CropStage } from "./CropStage.js";
import { SliderField } from "./SliderField.js";
import { ChoiceRow, ColorField, Section } from "./fields.js";
import {
  FULL_CROP,
  hasTransparency,
  type BackgroundMode,
  type CropRect,
  type ExtraAdjustments,
  type ImageDocument,
  type PhotoSettings,
  type QuarterTurn,
  type WatermarkPosition,
} from "./document.js";
import type { LoadedMedia } from "./renderImage.js";

export type CommitDoc = (update: (doc: ImageDocument) => ImageDocument, coalesceKey?: string) => void;

const FILTER_PRESET_NAMES: FilterPresetName[] = ["none", "warm", "cool", "mono", "vintage"];
const CROP_ASPECTS: Array<{ label: string; ratio: number | null }> = [
  { label: "Free", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
];
const WATERMARK_POSITIONS: WatermarkPosition[] = ["top-left", "top-right", "center", "bottom-left", "bottom-right"];

// Largest centered crop of the requested aspect ratio that fits inside the source image.
export function cropForAspect(naturalWidth: number, naturalHeight: number, ratio: number): CropRect {
  const imageRatio = naturalWidth / naturalHeight;
  const width = imageRatio > ratio ? ratio / imageRatio : 1;
  const height = imageRatio > ratio ? 1 : imageRatio / ratio;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

interface PhotoPanelsProps {
  doc: ImageDocument;
  photo: LoadedMedia | null;
  background: LoadedMedia | null;
  commit: CommitDoc;
  /** Opens one undo step for a crop drag; the drag's moves then go through `live`. */
  checkpoint: () => void;
  live: (update: (doc: ImageDocument) => ImageDocument) => void;
  onLoadBackgroundImage: (file: File) => void;
  customRatio: { w: number; h: number };
  onCustomRatioChange: (ratio: { w: number; h: number }) => void;
}

export function PhotoPanels({
  doc,
  photo,
  background,
  commit,
  checkpoint,
  live,
  onLoadBackgroundImage,
  customRatio,
  onCustomRatioChange,
}: PhotoPanelsProps) {
  const { photo: settings, background: bg, frame, watermark } = doc;

  const updatePhoto = (patch: Partial<PhotoSettings>, key?: string) =>
    commit((d) => ({ ...d, photo: { ...d.photo, ...patch } }), key && `photo:${key}`);
  const updateFilter = (patch: Partial<ClipFilter>, key: string) =>
    commit((d) => ({ ...d, photo: { ...d.photo, filter: { ...d.photo.filter, preset: null, ...patch } } }), `filter:${key}`);
  const updateExtras = (patch: Partial<ExtraAdjustments>, key: string) =>
    commit((d) => ({ ...d, photo: { ...d.photo, extras: { ...d.photo.extras, ...patch } } }), `extras:${key}`);
  const updateBackground = (patch: Partial<ImageDocument["background"]>, key?: string) =>
    commit((d) => ({ ...d, background: { ...d.background, ...patch } }), key && `background:${key}`);
  const updateFrame = (patch: Partial<ImageDocument["frame"]>, key?: string) =>
    commit((d) => ({ ...d, frame: { ...d.frame, ...patch } }), key && `frame:${key}`);
  const updateWatermark = (patch: Partial<ImageDocument["watermark"]>, key?: string) =>
    commit((d) => ({ ...d, watermark: { ...d.watermark, ...patch } }), key && `watermark:${key}`);

  function applyCropAspect(label: string, ratio: number | null) {
    if (!photo) return;
    updatePhoto({ cropAspect: label, crop: ratio == null ? FULL_CROP : cropForAspect(photo.width, photo.height, ratio) });
  }

  function applyCustomCropRatio() {
    if (!photo || customRatio.w <= 0 || customRatio.h <= 0) return;
    updatePhoto({ cropAspect: "custom", crop: cropForAspect(photo.width, photo.height, customRatio.w / customRatio.h) });
  }

  return (
    <>
      {photo && (
        <Section title="Crop">
          <CropStage
            src={photo.url}
            crop={settings.crop}
            onDragStart={checkpoint}
            onChange={(crop) => live((d) => ({ ...d, photo: { ...d.photo, crop, cropAspect: "Free" } }))}
          />
          <div className="inline-fields inline-fields-wrap">
            {CROP_ASPECTS.map((option) => (
              <button
                key={option.label}
                type="button"
                className={settings.cropAspect === option.label ? "active" : ""}
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
                value={customRatio.w}
                onChange={(e) => onCustomRatioChange({ ...customRatio, w: Math.max(1, Number(e.target.value)) })}
              />
              <span>:</span>
              <input
                type="number"
                min={1}
                className="ie-ratio-input"
                value={customRatio.h}
                onChange={(e) => onCustomRatioChange({ ...customRatio, h: Math.max(1, Number(e.target.value)) })}
              />
              <button type="button" className={settings.cropAspect === "custom" ? "active" : ""} onClick={applyCustomCropRatio}>
                Apply
              </button>
            </div>
          </div>
        </Section>
      )}

      <Section title="Transform">
        <div className="inline-fields inline-fields-wrap">
          <button type="button" onClick={() => updatePhoto({ rotation: ((settings.rotation + 270) % 360) as QuarterTurn })}>
            ↺ Left 90°
          </button>
          <button type="button" onClick={() => updatePhoto({ rotation: ((settings.rotation + 90) % 360) as QuarterTurn })}>
            ↻ Right 90°
          </button>
          <button type="button" className={settings.flipH ? "active" : ""} onClick={() => updatePhoto({ flipH: !settings.flipH })}>
            ⇋ Flip H
          </button>
          <button type="button" className={settings.flipV ? "active" : ""} onClick={() => updatePhoto({ flipV: !settings.flipV })}>
            ⇵ Flip V
          </button>
        </div>
        <SliderField
          label="Straighten"
          value={settings.fineRotationDeg}
          min={-45}
          max={45}
          step={0.5}
          onChange={(v) => updatePhoto({ fineRotationDeg: v }, "straighten")}
          format={(v) => `${v.toFixed(1)}°`}
        />
        <ChoiceRow
          label="Fit mode"
          value={settings.fitMode}
          options={[
            { id: "fit", label: "Fit" },
            { id: "fill", label: "Fill" },
            { id: "stretch", label: "Stretch" },
          ]}
          onChange={(fitMode) => updatePhoto({ fitMode })}
        />
      </Section>

      <Section title="Position">
        <p className="hint">Drag the photo on the preview to move it, or fine-tune here.</p>
        <SliderField
          label="Zoom"
          value={settings.zoom}
          min={0.25}
          max={3}
          step={0.01}
          onChange={(v) => updatePhoto({ zoom: v }, "zoom")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderField
          label="Offset X"
          value={Math.round(settings.offsetX * 100)}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => updatePhoto({ offsetX: v / 100 }, "offsetX")}
          format={(v) => `${v}%`}
        />
        <SliderField
          label="Offset Y"
          value={Math.round(settings.offsetY * 100)}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => updatePhoto({ offsetY: v / 100 }, "offsetY")}
          format={(v) => `${v}%`}
        />
        <div className="inline-fields">
          <button
            type="button"
            disabled={settings.zoom === 1 && settings.offsetX === 0 && settings.offsetY === 0}
            onClick={() => updatePhoto({ zoom: 1, offsetX: 0, offsetY: 0 })}
          >
            Reset position
          </button>
        </div>
      </Section>

      <Section title="Background fill">
        <p className="hint">Shows wherever the photo doesn't fill the frame (Fit mode, or any transparent area).</p>
        <ChoiceRow
          value={bg.mode}
          options={[
            { id: "solid", label: "Solid" },
            { id: "blur", label: "Blurred photo" },
            { id: "image", label: "Another image" },
            { id: "transparent", label: "Transparent" },
          ]}
          onChange={(mode: BackgroundMode) => updateBackground({ mode })}
        />
        {bg.mode === "transparent" ? (
          <p className="hint">
            Nothing is painted behind the photo: a transparent PNG (a logo, a cut-out) keeps its transparency in PNG and WebP exports.
          </p>
        ) : (
          <ColorField label="Base color" value={bg.color} onChange={(color) => updateBackground({ color: color ?? "#000000" }, "color")} />
        )}
        {bg.mode === "blur" && (
          <SliderField
            label="Blur amount"
            value={bg.blur}
            min={0}
            max={80}
            step={1}
            onChange={(v) => updateBackground({ blur: v }, "blur")}
            format={(v) => `${v}px`}
          />
        )}
        {bg.mode === "image" && (
          <label className="field">
            <span>Background image{background ? ` — ${background.width}×${background.height}` : ""}</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onLoadBackgroundImage(file);
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
              className={(settings.filter.preset ?? "none") === name ? "active" : ""}
              onClick={() => updatePhoto({ filter: applyFilterPreset(name) })}
            >
              {name}
            </button>
          ))}
        </div>
        <SliderField
          label="Brightness"
          value={settings.filter.brightness}
          min={-0.5}
          max={0.5}
          step={0.01}
          onChange={(v) => updateFilter({ brightness: v }, "brightness")}
          format={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`}
        />
        <SliderField
          label="Contrast"
          value={settings.filter.contrast}
          min={0.5}
          max={1.5}
          step={0.01}
          onChange={(v) => updateFilter({ contrast: v }, "contrast")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderField
          label="Saturation"
          value={settings.filter.saturation}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => updateFilter({ saturation: v }, "saturation")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderField
          label="Hue"
          value={settings.filter.hue}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => updateFilter({ hue: v }, "hue")}
          format={(v) => `${v}°`}
        />
        <SliderField
          label="Blur"
          value={settings.extras.blur}
          min={0}
          max={20}
          step={0.5}
          onChange={(v) => updateExtras({ blur: v }, "blur")}
          format={(v) => `${v}px`}
        />
        <SliderField
          label="Sepia"
          value={settings.extras.sepia}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => updateExtras({ sepia: v }, "sepia")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderField
          label="Grayscale"
          value={settings.extras.grayscale}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => updateExtras({ grayscale: v }, "grayscale")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderField
          label="Invert"
          value={settings.extras.invert}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => updateExtras({ invert: v }, "invert")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderField
          label="Opacity"
          value={settings.extras.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => updateExtras({ opacity: v }, "opacity")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Section>

      <Section title="Frame">
        <SliderField
          label="Border width"
          value={frame.borderWidth}
          min={0}
          max={80}
          step={1}
          onChange={(v) => updateFrame({ borderWidth: v }, "borderWidth")}
          format={(v) => `${v}px`}
        />
        <ColorField
          label="Border color"
          value={frame.borderColor}
          onChange={(color) => updateFrame({ borderColor: color ?? "#ffffff" }, "borderColor")}
        />
        <SliderField
          label="Corner radius"
          value={frame.cornerRadius}
          min={0}
          max={100}
          step={1}
          onChange={(v) => updateFrame({ cornerRadius: v }, "cornerRadius")}
          format={(v) => `${v}%`}
        />
        {hasTransparency(doc) && (
          <>
            <ColorField
              label={bg.mode === "transparent" ? "Behind transparency" : "Behind the corners"}
              value={frame.matte}
              allowNone
              fallback="#ffffff"
              onChange={(matte) => updateFrame({ matte }, "matte")}
            />
            <p className="hint">
              {frame.matte
                ? "Transparent areas are filled with this colour in every format."
                : "Transparent areas stay transparent in PNG and WebP. JPEG can't store transparency, so with JPEG selected the preview and export fill them with white."}
            </p>
          </>
        )}
      </Section>

      <Section title="Watermark">
        <label className="field">
          <span>Text</span>
          <input
            type="text"
            value={watermark.text}
            placeholder="© Your name"
            onChange={(e) => updateWatermark({ text: e.target.value }, "text")}
          />
        </label>
        {watermark.text.trim() && (
          <>
            <div className="field">
              <span>Position</span>
              <div className="inline-fields inline-fields-wrap">
                {WATERMARK_POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    className={watermark.position === pos ? "active" : ""}
                    onClick={() => updateWatermark({ position: pos })}
                  >
                    {pos.replace("-", " ")}
                  </button>
                ))}
              </div>
            </div>
            <SliderField
              label="Size"
              value={watermark.sizeRatio}
              min={0.02}
              max={0.2}
              step={0.005}
              onChange={(v) => updateWatermark({ sizeRatio: v }, "size")}
              format={(v) => `${Math.round(v * 100)}% of width`}
            />
            <ColorField
              label="Color"
              value={watermark.color}
              onChange={(color) => updateWatermark({ color: color ?? "#ffffff" }, "color")}
            />
            <SliderField
              label="Opacity"
              value={watermark.opacity}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(v) => updateWatermark({ opacity: v }, "opacity")}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </>
        )}
      </Section>
    </>
  );
}
