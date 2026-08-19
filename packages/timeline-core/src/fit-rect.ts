import type { FitMode, Transform } from "@reel-studio/shared-types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeFitRect(
  canvasWidth: number,
  canvasHeight: number,
  clipWidth: number,
  clipHeight: number,
  mode: FitMode
): Rect {
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

// The ffmpeg-side equivalent of applyPanZoom: applied AFTER a clip has already been scaled/padded/
// cropped to the output width x height (mirroring how the preview applies pan/zoom on top of the
// already-fit rect) — scale that frame up, then crop the original width x height window back out of
// it at an offset. Empty string for a no-op transform, so existing clips render byte-identical.
export function buildPanZoomFilter(transform: Transform, width: number, height: number): string {
  if (transform.scale === 1 && transform.x === 0 && transform.y === 0) return "";
  const cropX = `max(0\\,min(iw-ow\\,(iw-ow)/2+${transform.x}*ow))`;
  const cropY = `max(0\\,min(ih-oh\\,(ih-oh)/2+${transform.y}*oh))`;
  return `,scale=${width}*${transform.scale}:${height}*${transform.scale},crop=${width}:${height}:${cropX}:${cropY}`;
}
