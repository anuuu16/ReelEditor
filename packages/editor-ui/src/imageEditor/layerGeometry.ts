import type { Layer } from "./document.js";
import { layoutText } from "./textLayout.js";

export interface LayerBox {
  /** Center and size in canvas pixels, rotation in degrees. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

/** A layer's on-canvas bounding box (text layers size their height from their content). */
export function getLayerBox(layer: Layer, canvasWidth: number, canvasHeight: number): LayerBox {
  const cx = layer.x * canvasWidth;
  const cy = layer.y * canvasHeight;
  if (layer.kind === "text") {
    const layout = layoutText(layer, canvasWidth);
    return { cx, cy, w: layout.width, h: layout.height, rotation: layer.rotation };
  }
  return { cx, cy, w: layer.width * canvasWidth, h: layer.height * canvasHeight, rotation: layer.rotation };
}

/** Converts a canvas-space point into a box's local (unrotated, center-origin) frame. */
export function toLocalPoint(box: LayerBox, px: number, py: number): { x: number; y: number } {
  const rad = (-box.rotation * Math.PI) / 180;
  const dx = px - box.cx;
  const dy = py - box.cy;
  return { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
}

/** Topmost visible, unlocked layer under a canvas-space point, or null. */
export function hitTestLayers(layers: Layer[], px: number, py: number, canvasWidth: number, canvasHeight: number): Layer | null {
  // Slop makes hairline shapes (a 2px line) grabbable without pixel-perfect aim.
  const slop = Math.max(6, canvasWidth * 0.006);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.visible || layer.locked) continue;
    const box = getLayerBox(layer, canvasWidth, canvasHeight);
    const local = toLocalPoint(box, px, py);
    if (Math.abs(local.x) <= box.w / 2 + slop && Math.abs(local.y) <= box.h / 2 + slop) return layer;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Gesture math — pure functions of the gesture's starting snapshot and the current pointer.

export type HandleId = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
export const HANDLE_DIRECTIONS: Record<HandleId, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> = {
  n: { sx: 0, sy: -1 },
  s: { sx: 0, sy: 1 },
  e: { sx: 1, sy: 0 },
  w: { sx: -1, sy: 0 },
  nw: { sx: -1, sy: -1 },
  ne: { sx: 1, sy: -1 },
  sw: { sx: -1, sy: 1 },
  se: { sx: 1, sy: 1 },
};
/** Smallest a layer can be dragged to, as a fraction of canvas width. */
export const MIN_SIZE_FRACTION = 0.02;

export interface ResizeGesture {
  handle: HandleId;
  /** Pointer position (canvas px) when the handle was grabbed. */
  start: { x: number; y: number };
  startLayer: Layer;
  startBox: LayerBox;
}

export function rotateVector(x: number, y: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return Math.round(a * 10) / 10;
}

/** Rotation implied by a pointer dragging the rotate handle (which sits above the box's top edge). */
export function rotationFromPointer(box: LayerBox, point: { x: number; y: number }, snap15: boolean): number {
  const raw = (Math.atan2(point.y - box.cy, point.x - box.cx) * 180) / Math.PI + 90;
  return normalizeAngle(snap15 ? Math.round(raw / 15) * 15 : raw);
}

/** Shift-drag: move along whichever axis the pointer has travelled further on. */
export function constrainToAxis(start: { x: number; y: number }, dx: number, dy: number, W: number, H: number): { x: number; y: number } {
  return Math.abs(dx * W) >= Math.abs(dy * H) ? { x: start.x + dx, y: start.y } : { x: start.x, y: start.y + dy };
}

/** Snaps a centre to the canvas centre when within `thresholdPx` (0 disables). */
export function snapToCenter(
  point: { x: number; y: number },
  thresholdPx: number,
  W: number,
  H: number,
): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  const snappedX = thresholdPx > 0 && Math.abs(point.x - 0.5) * W < thresholdPx;
  const snappedY = thresholdPx > 0 && Math.abs(point.y - 0.5) * H < thresholdPx;
  return { x: snappedX ? 0.5 : point.x, y: snappedY ? 0.5 : point.y, snappedX, snappedY };
}

/**
 * Resizing in the layer's own (rotated) frame: the pointer delta is projected onto the layer's
 * axes, the dragged edge(s) move by that amount, and the centre shifts by half the change so the
 * opposite edge stays pinned — which is what makes resize feel right on a rotated layer.
 */
export function computeResize(
  gesture: ResizeGesture,
  point: { x: number; y: number },
  shiftKey: boolean,
  W: number,
  H: number,
): Partial<Layer> {
  const { startBox, startLayer, handle } = gesture;
  const { sx, sy } = HANDLE_DIRECTIONS[handle];
  const startLocal = toLocalPoint(startBox, gesture.start.x, gesture.start.y);
  const local = toLocalPoint(startBox, point.x, point.y);
  const ldx = local.x - startLocal.x;
  const ldy = local.y - startLocal.y;
  const minW = MIN_SIZE_FRACTION * W;
  const minH = MIN_SIZE_FRACTION * W;

  const isCorner = sx !== 0 && sy !== 0;
  // Images keep their aspect by default (Shift frees them); everything else is free unless Shift is held.
  const lockAspect = startLayer.kind === "image" ? !shiftKey : shiftKey;

  let newW = Math.max(minW, startBox.w + sx * ldx);
  let newH = Math.max(minH, startBox.h + sy * ldy);
  const aspect = startBox.w / startBox.h;

  if (startLayer.kind === "text") {
    // Text height is derived from its content; corners scale the type along with the box.
    const fontSize = isCorner ? startLayer.fontSize * (newW / startBox.w) : startLayer.fontSize;
    const shift = rotateVector((sx * (newW - startBox.w)) / 2, 0, startBox.rotation);
    return {
      x: (startBox.cx + shift.x) / W,
      width: newW / W,
      fontSize,
      ...(isCorner ? { y: (startBox.cy + shift.y) / H } : {}),
    };
  }

  if (lockAspect) {
    if (isCorner) {
      // Follow whichever axis the pointer moved more along, so the scale tracks the cursor.
      const scaleW = newW / startBox.w;
      const scaleH = newH / startBox.h;
      const s = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
      newW = Math.max(minW, startBox.w * s);
      newH = newW / aspect;
    } else if (sx !== 0) {
      newH = newW / aspect;
    } else {
      newW = newH * aspect;
    }
  }

  const dw = newW - startBox.w;
  const dh = newH - startBox.h;
  const shift = rotateVector((sx * dw) / 2, (sy * dh) / 2, startBox.rotation);
  return {
    x: (startBox.cx + shift.x) / W,
    y: (startBox.cy + shift.y) / H,
    width: newW / W,
    height: newH / H,
  };
}
