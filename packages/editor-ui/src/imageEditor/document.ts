import type { ClipFilter, FitMode } from "@reel-studio/shared-types";
import { NEUTRAL_FILTER } from "@reel-studio/timeline-core";

/**
 * The Image Editor's whole editable state as one plain, serializable object. Everything the
 * user can change lives here — which is what makes undo/redo (whole-document snapshots),
 * autosave (one IndexedDB record) and templates (a subset of the same shape) all trivial.
 *
 * Geometry conventions, chosen so a template designed at 1080×1920 still looks right when the
 * output size changes:
 *  - positions and sizes are fractions of the output canvas (x/width of its width, y/height of
 *    its height); a layer's x/y is its CENTER.
 *  - "length" values (font size, stroke width, corner radius, shadow blur) are fractions of the
 *    output canvas WIDTH. The UI shows them as pixels at the current size.
 */

export interface CropRect {
  /** All normalized 0..1 against the source image's natural dimensions. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** "transparent" leaves the source's alpha (and any letterbox area) see-through — for logos and cut-outs. */
export type BackgroundMode = "solid" | "blur" | "image" | "transparent";
export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
export type OutputFormat = "png" | "jpeg" | "webp";
export type QuarterTurn = 0 | 90 | 180 | 270;

export interface ExtraAdjustments {
  blur: number; // px
  sepia: number; // 0..1
  grayscale: number; // 0..1
  invert: number; // 0..1
  opacity: number; // 0..1
}

export const NEUTRAL_EXTRAS: ExtraAdjustments = { blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 1 };

/** Canvas `globalCompositeOperation` values that make sense as layer blend modes. */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const SHAPE_TYPES = ["rectangle", "ellipse", "triangle", "star", "line", "arrow"] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

export const FONT_FAMILIES: Array<{ id: string; label: string; stack: string }> = [
  { id: "sans", label: "Sans", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { id: "serif", label: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  { id: "display", label: "Display", stack: 'Impact, "Arial Black", "Helvetica Neue", sans-serif' },
  { id: "rounded", label: "Rounded", stack: '"Arial Rounded MT Bold", "Trebuchet MS", Verdana, sans-serif' },
  { id: "mono", label: "Mono", stack: '"Courier New", Courier, monospace' },
  { id: "script", label: "Script", stack: '"Brush Script MT", "Segoe Script", "Comic Sans MS", cursive' },
  { id: "emoji", label: "Emoji", stack: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif' },
];

/** Quick-add stickers — emoji rendered as oversized text layers, so they scale and rotate like anything else. */
export const STICKERS = ["🔥", "⭐", "❤️", "✨", "🎉", "👍", "😂", "😍", "💯", "🚀", "☀️", "🌈", "📍", "🎵", "💬", "⚡"];

/** A drop shadow under a layer's content. Lengths are fractions of canvas width. */
export interface LayerShadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export function fontStack(id: string): string {
  return (FONT_FAMILIES.find((f) => f.id === id) ?? FONT_FAMILIES[0]).stack;
}

interface LayerBase {
  id: string;
  name: string;
  /** Center, as a fraction of the canvas width/height. */
  x: number;
  y: number;
  /** Fractions of the canvas width/height. */
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number; // 0..1
  blendMode: BlendMode;
  visible: boolean;
  /** Locked layers are skipped by on-canvas hit-testing and dragging, but stay editable from the panel. */
  locked: boolean;
  flipH: boolean;
  flipV: boolean;
  shadow: LayerShadow | null;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  fontFamily: string;
  /** Fraction of canvas width. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number; // multiplier
  /** Inner padding as a fraction of canvas width — only visible with a background or when wrapping. */
  padding: number;
  background: string | null;
  backgroundRadius: number; // fraction of canvas width
  outlineColor: string | null;
  outlineWidth: number; // fraction of canvas width
}

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: ShapeType;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number; // fraction of canvas width
  /** Rectangle only. Fraction of canvas width. */
  cornerRadius: number;
  /** Star only. */
  points: number;
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  mediaId: string;
  cornerRadius: number; // fraction of canvas width
  grayscale: boolean;
}

export type Layer = TextLayer | ShapeLayer | ImageLayer;
export type LayerKind = Layer["kind"];

export interface PhotoSettings {
  fitMode: FitMode;
  crop: CropRect;
  /** Which crop-aspect button is highlighted ("Free", "1:1", "custom", …) — purely a UI memo. */
  cropAspect: string;
  rotation: QuarterTurn;
  fineRotationDeg: number;
  flipH: boolean;
  flipV: boolean;
  /** Pan/zoom applied after fitting: 1 = exactly the fit result; offsets are canvas fractions. */
  zoom: number;
  offsetX: number;
  offsetY: number;
  filter: ClipFilter;
  extras: ExtraAdjustments;
}

export interface BackgroundSettings {
  mode: BackgroundMode;
  color: string;
  blur: number; // px
  mediaId: string | null;
}

export interface FrameSettings {
  borderWidth: number; // px
  borderColor: string;
  /** Percent of half the shorter side: 100 = fully round on the short axis. */
  cornerRadius: number;
  /**
   * What shows through transparency — outside rounded corners, and everywhere with a transparent
   * background. `null` = keep it transparent (PNG/WebP carry alpha; JPEG has none, so export
   * flattens onto white instead of the black that an unflattened encode gives).
   */
  matte: string | null;
}

export interface WatermarkSettings {
  text: string;
  sizeRatio: number; // fraction of output width
  color: string;
  opacity: number;
  position: WatermarkPosition;
}

export interface ExportSettings {
  format: OutputFormat;
  quality: number; // 0..1, lossy formats only
}

export interface ImageDocument {
  version: 1;
  /** Id of the photo's blob in the media store; null until a photo is loaded. */
  sourceMediaId: string | null;
  sourceName: string;
  canvas: { aspectId: string; width: number; height: number };
  photo: PhotoSettings;
  background: BackgroundSettings;
  frame: FrameSettings;
  watermark: WatermarkSettings;
  layers: Layer[];
  export: ExportSettings;
}

/** The parts of a document that describe a *look* rather than a particular photo — what a template stores. */
export type TemplateConfig = Pick<ImageDocument, "canvas" | "background" | "frame" | "watermark" | "layers"> & {
  photo: Pick<PhotoSettings, "fitMode" | "zoom" | "offsetX" | "offsetY" | "filter" | "extras">;
};

export function createDefaultPhotoSettings(): PhotoSettings {
  return {
    fitMode: "fit",
    crop: FULL_CROP,
    cropAspect: "Free",
    rotation: 0,
    fineRotationDeg: 0,
    flipH: false,
    flipV: false,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    filter: NEUTRAL_FILTER,
    extras: NEUTRAL_EXTRAS,
  };
}

export function createDefaultDocument(): ImageDocument {
  return {
    version: 1,
    sourceMediaId: null,
    sourceName: "image",
    canvas: { aspectId: "9:16", width: 1080, height: 1920 },
    photo: createDefaultPhotoSettings(),
    background: { mode: "solid", color: "#000000", blur: 24, mediaId: null },
    frame: { borderWidth: 0, borderColor: "#ffffff", cornerRadius: 0, matte: null },
    watermark: { text: "", sizeRatio: 0.05, color: "#ffffff", opacity: 0.8, position: "bottom-right" },
    layers: [],
    export: { format: "png", quality: 0.9 },
  };
}

/**
 * Fills in fields a stored document or template may predate, so older records keep loading as
 * the model grows. (Text layers used to carry `shadowColor`/`shadowBlur` before shadows became a
 * property of every layer.)
 */
export function normalizeLayer(raw: Layer): Layer {
  const legacy = raw as Layer & { shadowColor?: string | null; shadowBlur?: number };
  const { shadowColor, shadowBlur, ...rest } = legacy;
  const shadow: LayerShadow | null =
    rest.shadow !== undefined
      ? rest.shadow
      : shadowColor
        ? { ...DEFAULT_SHADOW, color: shadowColor, blur: shadowBlur ?? DEFAULT_SHADOW.blur }
        : null;
  return { ...rest, flipH: rest.flipH ?? false, flipV: rest.flipV ?? false, shadow } as Layer;
}

export function normalizeDocument(doc: ImageDocument): ImageDocument {
  const base = createDefaultDocument();
  return {
    ...base,
    ...doc,
    photo: { ...base.photo, ...doc.photo },
    background: { ...base.background, ...doc.background },
    frame: { ...base.frame, ...doc.frame },
    watermark: { ...base.watermark, ...doc.watermark },
    export: { ...base.export, ...doc.export },
    layers: (doc.layers ?? []).map(normalizeLayer),
  };
}

/**
 * The "before" of a document: the same photo, untouched, fitted into the same output frame — so a
 * side-by-side or slider comparison lines up. Nothing else carries over: no crop, orientation,
 * adjustments, layers, frame or watermark.
 */
export function originalDocument(doc: ImageDocument): ImageDocument {
  const base = createDefaultDocument();
  return {
    ...base,
    sourceMediaId: doc.sourceMediaId,
    sourceName: doc.sourceName,
    canvas: { ...doc.canvas },
    export: { ...doc.export },
  };
}

/** Extracts the reusable "look" from a document (everything except the photo and its crop/orientation). */
export function extractTemplateConfig(doc: ImageDocument): TemplateConfig {
  const { fitMode, zoom, offsetX, offsetY, filter, extras } = doc.photo;
  return {
    canvas: { ...doc.canvas },
    background: { ...doc.background },
    frame: { ...doc.frame },
    watermark: { ...doc.watermark },
    layers: doc.layers.map((l) => ({ ...l })),
    photo: { fitMode, zoom, offsetX, offsetY, filter, extras },
  };
}

/** Applies a template's look to a document while keeping its photo, crop and orientation. */
export function applyTemplateConfig(doc: ImageDocument, config: TemplateConfig): ImageDocument {
  return {
    ...doc,
    canvas: { ...config.canvas },
    background: { ...config.background },
    frame: { ...config.frame },
    watermark: { ...config.watermark },
    layers: config.layers.map(normalizeLayer),
    photo: { ...doc.photo, ...config.photo },
  };
}

/** Whether a render of this document can contain transparent pixels (rounded corners or a transparent background). */
export function hasTransparency(doc: Pick<ImageDocument, "frame" | "background">): boolean {
  return doc.frame.cornerRadius > 0 || doc.background.mode === "transparent";
}

/** Every media id a document refers to — used to decide which blobs to keep in storage. */
export function referencedMediaIds(doc: ImageDocument | TemplateConfig): string[] {
  const ids: string[] = [];
  if ("sourceMediaId" in doc && doc.sourceMediaId) ids.push(doc.sourceMediaId);
  if (doc.background.mediaId) ids.push(doc.background.mediaId);
  for (const layer of doc.layers) if (layer.kind === "image") ids.push(layer.mediaId);
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Layer factories

export const DEFAULT_SHADOW: LayerShadow = { color: "rgba(0,0,0,0.5)", blur: 0.01, offsetX: 0, offsetY: 0.004 };

const layerDefaults = (): Omit<LayerBase, "id" | "name" | "width" | "height"> => ({
  x: 0.5,
  y: 0.5,
  rotation: 0,
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  flipH: false,
  flipV: false,
  shadow: null,
});

export function createTextLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    ...layerDefaults(),
    id: crypto.randomUUID(),
    name: "Text",
    kind: "text",
    width: 0.8,
    height: 0.1,
    text: "Your text here",
    fontFamily: "sans",
    fontSize: 0.07,
    bold: true,
    italic: false,
    color: "#ffffff",
    align: "center",
    lineHeight: 1.2,
    padding: 0.02,
    background: null,
    backgroundRadius: 0.02,
    outlineColor: null,
    outlineWidth: 0.004,
    shadow: { ...DEFAULT_SHADOW },
    ...overrides,
  };
}

export function createStickerLayer(emoji: string): TextLayer {
  return createTextLayer({
    name: `Sticker ${emoji}`,
    text: emoji,
    fontFamily: "emoji",
    fontSize: 0.2,
    width: 0.3,
    bold: false,
    padding: 0.01,
    shadow: null,
  });
}

export function createShapeLayer(shape: ShapeType, overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  const isLine = shape === "line" || shape === "arrow";
  return {
    ...layerDefaults(),
    id: crypto.randomUUID(),
    name: shape.charAt(0).toUpperCase() + shape.slice(1),
    kind: "shape",
    shape,
    width: isLine ? 0.5 : 0.4,
    height: isLine ? 0.01 : 0.25,
    fill: isLine ? null : "#5b7cff",
    stroke: isLine ? "#ffffff" : null,
    strokeWidth: 0.008,
    cornerRadius: 0.02,
    points: 5,
    ...overrides,
  };
}

export function createImageLayer(mediaId: string, name: string, aspect: number, overrides: Partial<ImageLayer> = {}): ImageLayer {
  // `aspect` is the image's width/height; the box starts at 40% of the canvas width and matches it
  // in canvas pixels — callers pass `canvasAspect` so the height fraction comes out right.
  return {
    ...layerDefaults(),
    id: crypto.randomUUID(),
    name,
    kind: "image",
    mediaId,
    width: 0.4,
    height: 0.4 / aspect,
    cornerRadius: 0,
    grayscale: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Layer list operations (pure; all return a new array)

export function moveLayer(layers: Layer[], id: string, direction: "up" | "down" | "top" | "bottom"): Layer[] {
  const index = layers.findIndex((l) => l.id === id);
  if (index === -1) return layers;
  // The array is bottom-to-top (index 0 draws first), so "up" = later in the array.
  const target = direction === "up" ? index + 1 : direction === "down" ? index - 1 : direction === "top" ? layers.length - 1 : 0;
  if (target < 0 || target >= layers.length || target === index) return layers;
  const next = layers.slice();
  const [layer] = next.splice(index, 1);
  next.splice(target, 0, layer);
  return next;
}

export function reorderLayer(layers: Layer[], id: string, toIndex: number): Layer[] {
  const index = layers.findIndex((l) => l.id === id);
  if (index === -1) return layers;
  const clamped = Math.max(0, Math.min(layers.length - 1, toIndex));
  if (clamped === index) return layers;
  const next = layers.slice();
  const [layer] = next.splice(index, 1);
  next.splice(clamped, 0, layer);
  return next;
}

export function duplicateLayer(layers: Layer[], id: string): { layers: Layer[]; newId: string | null } {
  const index = layers.findIndex((l) => l.id === id);
  if (index === -1) return { layers, newId: null };
  const source = layers[index];
  const copy: Layer = { ...source, id: crypto.randomUUID(), name: `${source.name} copy`, x: source.x + 0.03, y: source.y + 0.03 };
  const next = layers.slice();
  next.splice(index + 1, 0, copy);
  return { layers: next, newId: copy.id };
}

export function updateLayer(layers: Layer[], id: string, patch: Partial<Layer>): Layer[] {
  return layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l));
}
