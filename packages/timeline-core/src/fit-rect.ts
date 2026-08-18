import type { FitMode } from "@reel-studio/shared-types";

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
