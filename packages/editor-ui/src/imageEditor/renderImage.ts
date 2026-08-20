import type { ClipFilter, FitMode } from "@reel-studio/shared-types";
import { buildCanvasFilterString, computeFitRect } from "@reel-studio/timeline-core";

export interface CropRect {
  /** All normalized 0..1 against the source image's natural dimensions. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BackgroundMode = "solid" | "blur" | "image";
export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export interface ExtraAdjustments {
  blur: number; // px
  sepia: number; // 0..1
  grayscale: number; // 0..1
  invert: number; // 0..1
  opacity: number; // 0..1
}

export interface Watermark {
  text: string;
  sizeRatio: number; // fraction of output width
  color: string;
  opacity: number;
  position: WatermarkPosition;
}

export interface RenderImageOptions {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  width: number;
  height: number;
  fitMode: FitMode;
  crop: CropRect | null;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  filter: ClipFilter;
  extras: ExtraAdjustments;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundBlur: number;
  backgroundImage: HTMLImageElement | null;
  borderWidth: number; // px
  borderColor: string;
  cornerRadius: number; // percent of the output's shorter side
  watermark: Watermark | null;
}

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

function tracePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
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

// Draws an image scaled to cover the whole output (center-cropped), used for both background modes.
// `overscan` grows the draw slightly so a blurred background doesn't fade to transparent at the edges.
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  filter: string,
  overscan = 1
) {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight) * overscan;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.save();
  ctx.filter = filter;
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
  ctx.restore();
}

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, mark: Watermark) {
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

export function renderImage(options: RenderImageOptions): void {
  const {
    canvas,
    image,
    width,
    height,
    fitMode,
    crop,
    rotation,
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
    watermark,
  } = options;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);
  const radiusPx = (cornerRadius / 100) * (Math.min(width, height) / 2);

  ctx.save();
  if (radiusPx > 0) {
    tracePath(ctx, 0, 0, width, height, radiusPx);
    ctx.clip();
  }

  // Background sits under the fitted image — visible wherever letterbox bars would otherwise be.
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);
  if (backgroundMode === "blur") {
    drawCover(ctx, image, width, height, `blur(${backgroundBlur}px)`, 1.15);
  } else if (backgroundMode === "image" && backgroundImage) {
    drawCover(ctx, backgroundImage, width, height, "none");
  }

  // Source sub-rectangle: the crop, or the whole image when uncropped.
  const natW = image.naturalWidth;
  const natH = image.naturalHeight;
  const sx = crop ? crop.x * natW : 0;
  const sy = crop ? crop.y * natH : 0;
  const sw = crop ? crop.width * natW : natW;
  const sh = crop ? crop.height * natH : natH;

  // A quarter turn swaps which source axis maps to the output's width/height, so the fit is
  // computed against the rotated bounding box and the draw size is swapped back.
  const quarter = rotation === 90 || rotation === 270;
  const rect = computeFitRect(width, height, quarter ? sh : sw, quarter ? sw : sh, fitMode);
  const drawW = quarter ? rect.height : rect.width;
  const drawH = quarter ? rect.width : rect.height;

  ctx.save();
  ctx.filter = buildImageFilterString(filter, extras);
  ctx.globalAlpha = extras.opacity;
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(image, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  if (borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    tracePath(ctx, borderWidth / 2, borderWidth / 2, width - borderWidth, height - borderWidth, Math.max(0, radiusPx - borderWidth / 2));
    ctx.stroke();
    ctx.restore();
  }

  if (watermark && watermark.text.trim()) {
    drawWatermark(ctx, width, height, watermark);
  }

  ctx.restore();
}
