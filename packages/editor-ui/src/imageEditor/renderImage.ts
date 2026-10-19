import type { ClipFilter } from "@reel-studio/shared-types";
import { buildCanvasFilterString, computeFitRect } from "@reel-studio/timeline-core";
import {
  hasTransparency,
  referencedMediaIds,
  type ExtraAdjustments,
  type ImageDocument,
  type ImageLayer,
  type Layer,
  type LayerShadow,
  type OutputFormat,
  type ShapeLayer,
  type TextLayer,
  type WatermarkSettings,
} from "./document.js";
import { getLayerBox, type LayerBox } from "./layerGeometry.js";
import { layoutText, textFont } from "./textLayout.js";

/** An image the document refers to by id, decoded and ready to draw. */
export interface LoadedMedia {
  id: string;
  blob: Blob;
  url: string;
  image: HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
}

export type MediaMap = Record<string, LoadedMedia>;

export const FORMAT_INFO: Record<OutputFormat, { label: string; mime: string; ext: string; lossy: boolean; alpha: boolean }> = {
  png: { label: "PNG", mime: "image/png", ext: "png", lossy: false, alpha: true },
  jpeg: { label: "JPEG", mime: "image/jpeg", ext: "jpg", lossy: true, alpha: false },
  webp: { label: "WebP", mime: "image/webp", ext: "webp", lossy: true, alpha: true },
};

/** What JPEG export flattens transparent corners onto when no matte colour is chosen. */
export const JPEG_FALLBACK_MATTE = "#ffffff";

// Composes the shared clip-filter math (kept identical to the video editor) with the extra
// image-only adjustments that have no per-clip equivalent.
export function buildImageFilterString(filter: ClipFilter, extras: ExtraAdjustments): string {
  const parts = [buildCanvasFilterString(filter)];
  if (extras.blur > 0) parts.push(`blur(${extras.blur}px)`);
  if (extras.sepia > 0) parts.push(`sepia(${extras.sepia})`);
  if (extras.grayscale > 0) parts.push(`grayscale(${extras.grayscale})`);
  if (extras.invert > 0) parts.push(`invert(${extras.invert})`);
  return parts.join(" ");
}

function traceRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  const r = Math.min(radius, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Pixel radius of the frame's rounded corners for a given output size. */
export function frameRadiusPx(doc: ImageDocument): number {
  const { width, height } = doc.canvas;
  return (doc.frame.cornerRadius / 100) * (Math.min(width, height) / 2);
}

// ---------------------------------------------------------------------------------------------
// Layer geometry

// ---------------------------------------------------------------------------------------------
// Layer drawing — every function draws centred on the origin of an already-transformed context.

function traceShape(ctx: CanvasRenderingContext2D, layer: ShapeLayer, w: number, h: number, canvasWidth: number) {
  ctx.beginPath();
  switch (layer.shape) {
    case "rectangle":
      traceRoundedRect(ctx, -w / 2, -h / 2, w, h, layer.cornerRadius * canvasWidth);
      break;
    case "ellipse":
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "triangle":
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      break;
    case "star": {
      const points = Math.max(3, Math.round(layer.points));
      const outerX = w / 2;
      const outerY = h / 2;
      const inner = 0.45;
      for (let i = 0; i < points * 2; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        const scale = i % 2 === 0 ? 1 : inner;
        const x = Math.cos(angle) * outerX * scale;
        const y = Math.sin(angle) * outerY * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "line":
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      break;
    case "arrow": {
      const head = Math.min(w / 2, Math.max(h * 2, layer.strokeWidth * canvasWidth * 4));
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.moveTo(w / 2 - head, -head / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2 - head, head / 2);
      break;
    }
  }
}

function applyShadow(ctx: CanvasRenderingContext2D, shadow: LayerShadow | null, canvasWidth: number) {
  if (!shadow) return;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * canvasWidth;
  ctx.shadowOffsetX = shadow.offsetX * canvasWidth;
  ctx.shadowOffsetY = shadow.offsetY * canvasWidth;
}

function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawShapeLayer(ctx: CanvasRenderingContext2D, layer: ShapeLayer, box: LayerBox, canvasWidth: number) {
  const isLine = layer.shape === "line" || layer.shape === "arrow";
  traceShape(ctx, layer, box.w, box.h, canvasWidth);
  const hasFill = Boolean(layer.fill) && !isLine;
  // The shadow is cast once, by whichever pass draws the body (fill, else stroke), so a filled-and-
  // stroked shape doesn't get two stacked shadows.
  applyShadow(ctx, layer.shadow, canvasWidth);
  if (hasFill) {
    ctx.fillStyle = layer.fill!;
    ctx.fill();
    clearShadow(ctx);
  }
  const strokeWidth = (isLine ? Math.max(layer.strokeWidth, 0.001) : layer.strokeWidth) * canvasWidth;
  if (layer.stroke && strokeWidth > 0) {
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = isLine ? Math.max(strokeWidth, box.h) : strokeWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer, canvasWidth: number) {
  const layout = layoutText(layer, canvasWidth);
  const { width, height, paddingPx, lineHeightPx } = layout;

  if (layer.background) {
    ctx.fillStyle = layer.background;
    traceRoundedRect(ctx, -width / 2, -height / 2, width, height, layer.backgroundRadius * canvasWidth);
    ctx.fill();
  }

  ctx.font = textFont(layer, canvasWidth);
  ctx.textBaseline = "middle";
  ctx.textAlign = layer.align;
  const x = layer.align === "left" ? -width / 2 + paddingPx : layer.align === "right" ? width / 2 - paddingPx : 0;
  const outlineWidth = layer.outlineColor ? layer.outlineWidth * canvasWidth : 0;

  applyShadow(ctx, layer.shadow, canvasWidth);

  layout.lines.forEach((line, index) => {
    const y = -height / 2 + paddingPx + lineHeightPx * (index + 0.5);
    if (outlineWidth > 0) {
      ctx.strokeStyle = layer.outlineColor!;
      ctx.lineWidth = outlineWidth * 2; // half of the stroke sits under the fill
      ctx.lineJoin = "round";
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, x, y);
  });
}

function drawImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer, box: LayerBox, media: MediaMap, canvasWidth: number) {
  const source = media[layer.mediaId];
  if (!source) {
    // Blob missing (still loading, or gone from storage): draw a placeholder so the layer is still findable.
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    return;
  }
  const radius = layer.cornerRadius * canvasWidth;
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  // Drawn via an offscreen canvas so the shadow follows the image's real silhouette (rounded
  // corners, a transparent PNG's alpha) instead of its bounding box — and isn't clipped away.
  const scratch = getScratchCanvas(w, h);
  const sctx = scratch.getContext("2d")!;
  sctx.clearRect(0, 0, w, h);
  sctx.save();
  if (radius > 0) {
    traceRoundedRect(sctx, 0, 0, w, h, radius);
    sctx.clip();
  }
  if (layer.grayscale) sctx.filter = "grayscale(1)";
  sctx.drawImage(source.image, 0, 0, w, h);
  sctx.restore();
  applyShadow(ctx, layer.shadow, canvasWidth);
  ctx.drawImage(scratch, 0, 0, w, h, -box.w / 2, -box.h / 2, box.w, box.h);
}

let scratchCanvas: HTMLCanvasElement | null = null;
function getScratchCanvas(width: number, height: number): HTMLCanvasElement {
  if (!scratchCanvas) scratchCanvas = document.createElement("canvas");
  if (scratchCanvas.width !== width || scratchCanvas.height !== height) {
    scratchCanvas.width = width;
    scratchCanvas.height = height;
  }
  return scratchCanvas;
}

export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, media: MediaMap, canvasWidth: number, canvasHeight: number) {
  if (!layer.visible || layer.opacity <= 0) return;
  const box = getLayerBox(layer, canvasWidth, canvasHeight);
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode === "normal" ? "source-over" : layer.blendMode;
  ctx.translate(box.cx, box.cy);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  if (layer.flipH || layer.flipV) ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
  switch (layer.kind) {
    case "shape":
      drawShapeLayer(ctx, layer, box, canvasWidth);
      break;
    case "text":
      drawTextLayer(ctx, layer, canvasWidth);
      break;
    case "image":
      drawImageLayer(ctx, layer, box, media, canvasWidth);
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Base pass: background fill + the photo itself (crop, fit, orientation, pan/zoom, colour).

// Draws an image scaled to cover the whole output (center-cropped), used for both background modes.
// `overscan` grows the draw slightly so a blurred background doesn't fade to transparent at the edges.
function drawCover(ctx: CanvasRenderingContext2D, source: LoadedMedia, width: number, height: number, filter: string, overscan = 1) {
  const scale = Math.max(width / source.width, height / source.height) * overscan;
  const dw = source.width * scale;
  const dh = source.height * scale;
  ctx.save();
  ctx.filter = filter;
  ctx.drawImage(source.image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  ctx.restore();
}

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, mark: WatermarkSettings) {
  const fontSize = Math.max(8, mark.sizeRatio * width);
  const pad = fontSize * 0.6;
  ctx.save();
  ctx.globalAlpha = mark.opacity;
  ctx.fillStyle = mark.color;
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";

  let x = pad;
  let y = pad + fontSize / 2;
  ctx.textAlign = "left";
  if (mark.position === "top-right" || mark.position === "bottom-right") {
    ctx.textAlign = "right";
    x = width - pad;
  }
  if (mark.position === "bottom-left" || mark.position === "bottom-right") {
    y = height - pad - fontSize / 2;
  }
  if (mark.position === "center") {
    ctx.textAlign = "center";
    x = width / 2;
    y = height / 2;
  }
  ctx.fillText(mark.text, x, y);
  ctx.restore();
}

/** The photo's drawn rectangle (before orientation) — exported so the stage can show it. */
export function photoDrawRect(doc: ImageDocument, photo: LoadedMedia): { x: number; y: number; width: number; height: number } {
  const { width, height } = doc.canvas;
  const { crop, rotation, fitMode, zoom, offsetX, offsetY } = doc.photo;
  const sw = crop.width * photo.width;
  const sh = crop.height * photo.height;
  // A quarter turn swaps which source axis maps to the output's width/height, so the fit is
  // computed against the rotated bounding box.
  const quarter = rotation === 90 || rotation === 270;
  const rect = computeFitRect(width, height, quarter ? sh : sw, quarter ? sw : sh, fitMode);
  const w = rect.width * zoom;
  const h = rect.height * zoom;
  return {
    x: rect.x + (rect.width - w) / 2 + offsetX * width,
    y: rect.y + (rect.height - h) / 2 + offsetY * height,
    width: w,
    height: h,
  };
}

function drawBase(ctx: CanvasRenderingContext2D, doc: ImageDocument, media: MediaMap) {
  const { width, height } = doc.canvas;
  const photo = doc.sourceMediaId ? media[doc.sourceMediaId] : undefined;
  const { background } = doc;

  // Background sits under the fitted image — visible wherever letterbox bars would otherwise be
  // and through the source's own alpha. "transparent" paints nothing, so both stay see-through.
  if (background.mode !== "transparent") {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, width, height);
  }
  if (background.mode === "blur" && photo) {
    drawCover(ctx, photo, width, height, `blur(${background.blur}px)`, 1.15);
  } else if (background.mode === "image" && background.mediaId && media[background.mediaId]) {
    drawCover(ctx, media[background.mediaId], width, height, "none");
  }

  if (!photo) return;
  const { crop, rotation, fineRotationDeg, flipH, flipV, filter, extras } = doc.photo;
  const sx = crop.x * photo.width;
  const sy = crop.y * photo.height;
  const sw = crop.width * photo.width;
  const sh = crop.height * photo.height;

  const rect = photoDrawRect(doc, photo);
  const quarter = rotation === 90 || rotation === 270;
  const drawW = quarter ? rect.height : rect.width;
  const drawH = quarter ? rect.width : rect.height;

  ctx.save();
  ctx.filter = buildImageFilterString(filter, extras);
  ctx.globalAlpha = extras.opacity;
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.rotate(((rotation + fineRotationDeg) * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(photo.image, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/**
 * The base pass re-draws the (possibly huge) source photo, which is the slow part of a render.
 * While dragging a layer nothing about the photo changes, so the base is kept on an offscreen
 * canvas and reused until one of its inputs does.
 */
export interface BaseCache {
  key: string;
  canvas: HTMLCanvasElement;
}

function baseCacheKey(doc: ImageDocument, media: MediaMap): string {
  const loaded = referencedMediaIds(doc).map((id) => `${id}:${media[id] ? 1 : 0}`);
  return JSON.stringify([doc.sourceMediaId, doc.canvas, doc.photo, doc.background, loaded]);
}

export function renderBase(doc: ImageDocument, media: MediaMap, cache: BaseCache | null): BaseCache {
  const key = baseCacheKey(doc, media);
  if (cache && cache.key === key) return cache;
  const canvas = cache?.canvas ?? document.createElement("canvas");
  canvas.width = doc.canvas.width;
  canvas.height = doc.canvas.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBase(ctx, doc, media);
  }
  return { key, canvas };
}

// ---------------------------------------------------------------------------------------------
// Full render

export interface RenderOptions {
  canvas: HTMLCanvasElement;
  doc: ImageDocument;
  media: MediaMap;
  /** Pass the previous result back in to skip re-drawing the photo when only layers changed. */
  baseCache?: BaseCache | null;
  /** Overrides the document's matte — export uses this to flatten for formats without alpha. */
  matte?: string | null;
}

export function renderDocument(options: RenderOptions): BaseCache {
  const { canvas, doc, media } = options;
  const { width, height } = doc.canvas;
  const matte = options.matte === undefined ? doc.frame.matte : options.matte;

  const base = renderBase(doc, media, options.baseCache ?? null);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return base;
  ctx.clearRect(0, 0, width, height);

  const radiusPx = frameRadiusPx(doc);
  // The matte is painted BEFORE clipping and under everything, so it shows exactly where the
  // result would otherwise be transparent: the rounded-off corners, and the whole background
  // when that's set to transparent. Without it those pixels stay transparent — fine for PNG/WebP,
  // but a JPEG encode has no alpha channel and turns them black, which is the bug this fixes.
  if (hasTransparency(doc) && matte) {
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.save();
  if (radiusPx > 0) {
    traceRoundedRect(ctx, 0, 0, width, height, radiusPx);
    ctx.clip();
  }

  ctx.drawImage(base.canvas, 0, 0);

  for (const layer of doc.layers) drawLayer(ctx, layer, media, width, height);

  const { borderWidth, borderColor } = doc.frame;
  if (borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    traceRoundedRect(
      ctx,
      borderWidth / 2,
      borderWidth / 2,
      width - borderWidth,
      height - borderWidth,
      Math.max(0, radiusPx - borderWidth / 2),
    );
    ctx.stroke();
    ctx.restore();
  }

  if (doc.watermark.text.trim()) drawWatermark(ctx, width, height, doc.watermark);

  ctx.restore();
  return base;
}

/** Matte colour an export will actually use: the document's, or white when the format can't carry alpha. */
export function effectiveExportMatte(doc: ImageDocument, format: OutputFormat): string | null {
  if (doc.frame.matte) return doc.frame.matte;
  return FORMAT_INFO[format].alpha ? null : JPEG_FALLBACK_MATTE;
}

/** Encodes the document at full output size. Always renders fresh, so the preview canvas is untouched. */
export function exportDocument(doc: ImageDocument, media: MediaMap, format: OutputFormat, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  renderDocument({ canvas, doc, media, matte: effectiveExportMatte(doc, format) });
  const info = FORMAT_INFO[format];
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Could not encode ${info.label}`))),
      info.mime,
      info.lossy ? quality : undefined,
    );
  });
}

/** A small JPEG data URL of the document — for template thumbnails. */
export function renderThumbnail(doc: ImageDocument, media: MediaMap, maxEdge = 320): string {
  const full = document.createElement("canvas");
  renderDocument({ canvas: full, doc, media, matte: doc.frame.matte ?? "#1a1b20" });
  const scale = Math.min(1, maxEdge / Math.max(full.width, full.height));
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(full.width * scale));
  thumb.height = Math.max(1, Math.round(full.height * scale));
  thumb.getContext("2d")?.drawImage(full, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.8);
}

/** A soft gradient stand-in for "your photo goes here", used to preview built-in templates. */
export function createPlaceholderMedia(id: string, width = 1200, height = 1600): LoadedMedia {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#5b7cff");
    gradient.addColorStop(0.5, "#8a5cf6");
    gradient.addColorStop(1, "#f2a65a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(width * 0.7, height * 0.3, width * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  return { id, blob: new Blob(), url: "", image: canvas, width, height };
}
