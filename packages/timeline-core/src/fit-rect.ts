import type { FitMode, Transform } from "@reel-studio/shared-types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeFitRect(canvasWidth: number, canvasHeight: number, clipWidth: number, clipHeight: number, mode: FitMode): Rect {
  const ratioW = canvasWidth / clipWidth;
  const ratioH = canvasHeight / clipHeight;

  let scaleW: number;
  let scaleH: number;

  if (mode === "stretch") {
    scaleW = ratioW;
    scaleH = ratioH;
  } else {
    const ratio = mode === "fit" ? Math.min(ratioW, ratioH) : Math.max(ratioW, ratioH);
    scaleW = ratio;
    scaleH = ratio;
  }

  const width = clipWidth * scaleW;
  const height = clipHeight * scaleH;

  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

// Applies a clip's pan/zoom transform on top of an already-computed fit rect. scale > 1 zooms in;
// positive x/y pan the visible window right/down (revealing more of that side of the source).
export function applyPanZoom(rect: Rect, transform: Transform, canvasWidth: number, canvasHeight: number): Rect {
  const width = rect.width * transform.scale;
  const height = rect.height * transform.scale;
  return {
    width,
    height,
    x: rect.x - (width - rect.width) / 2 - transform.x * canvasWidth,
    y: rect.y - (height - rect.height) / 2 - transform.y * canvasHeight,
  };
}

function floorEven(value: number): number {
  return Math.max(0, Math.floor(value / 2) * 2);
}

// The ffmpeg-side equivalent of applyPanZoom: applied AFTER a clip has already been scaled/padded/
// cropped to the output width x height (mirroring how the preview applies pan/zoom on top of the
// already-fit rect). The frame is scaled up by `transform.scale` around its centre and shifted by
// (x, y) canvas-widths/heights exactly like applyPanZoom — including panning *past* the edge of the
// zoomed frame, where the preview simply shows the black canvas behind it. So rather than a clamped
// crop (which silently ignored any pan at 1x zoom, or beyond the zoomed frame's edge), this crops
// out just the part of the scaled frame that lands on the canvas and pads the rest with black.
// All geometry is static per clip, so it's resolved to integer pixels here (kept even for 4:2:0
// chroma). Empty string for a no-op transform, so existing clips render byte-identical.
export function buildPanZoomFilter(transform: Transform, width: number, height: number): string {
  if (transform.scale === 1 && transform.x === 0 && transform.y === 0) return "";
  const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
  const scaledW = Math.max(2, floorEven(width * scale));
  const scaledH = Math.max(2, floorEven(height * scale));

  // Where the canvas' left/top edge falls inside the scaled frame (negative = black before it).
  const offsetX = (scaledW - width) / 2 + transform.x * width;
  const offsetY = (scaledH - height) / 2 + transform.y * height;

  const axis = (offset: number, scaled: number, canvas: number) => {
    const canvasStart = floorEven(Math.max(0, -offset));
    const sourceStart = floorEven(Math.max(0, offset));
    const size = floorEven(Math.min(canvas - canvasStart, scaled - sourceStart));
    return { canvasStart, sourceStart, size: Math.max(2, size) };
  };
  const h = axis(offsetX, scaledW, width);
  const v = axis(offsetY, scaledH, height);

  return (
    `,scale=${scaledW}:${scaledH},crop=${h.size}:${v.size}:${h.sourceStart}:${v.sourceStart}` +
    `,pad=${width}:${height}:${h.canvasStart}:${v.canvasStart}:color=black`
  );
}
