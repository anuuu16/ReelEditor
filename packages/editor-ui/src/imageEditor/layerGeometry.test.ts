import { describe, expect, it } from "vitest";
import { createImageLayer, createShapeLayer, createTextLayer, type Layer, type ShapeLayer, type TextLayer } from "./document.js";
import {
  computeResize,
  constrainToAxis,
  getLayerBox,
  hitTestLayers,
  normalizeAngle,
  rotateVector,
  rotationFromPointer,
  snapToCenter,
  toLocalPoint,
  type HandleId,
} from "./layerGeometry.js";

const W = 1000;
const H = 2000;

function rect(overrides: Partial<ShapeLayer> = {}) {
  return createShapeLayer("rectangle", { id: "r", x: 0.5, y: 0.5, width: 0.4, height: 0.1, ...overrides }); // 400×200 px box centred at (500,1000)
}

describe("boxes and hit-testing", () => {
  it("converts a layer's fractions into a pixel box", () => {
    expect(getLayerBox(rect(), W, H)).toEqual({ cx: 500, cy: 1000, w: 400, h: 200, rotation: 0 });
  });

  it("maps canvas points into a rotated layer's local frame", () => {
    const box = { cx: 500, cy: 1000, w: 400, h: 200, rotation: 90 };
    // A point 100px below the centre of a box rotated 90° clockwise lies on the box's local +x axis.
    const local = toLocalPoint(box, 500, 1100);
    expect(local.x).toBeCloseTo(100);
    expect(local.y).toBeCloseTo(0);
  });

  it("hits the topmost layer under the pointer and passes through hidden/locked ones", () => {
    const bottom = rect({ id: "bottom" });
    const top = rect({ id: "top" });
    expect(hitTestLayers([bottom, top], 500, 1000, W, H)?.id).toBe("top");
    expect(hitTestLayers([bottom, { ...top, locked: true }], 500, 1000, W, H)?.id).toBe("bottom");
    expect(hitTestLayers([bottom, { ...top, visible: false }], 500, 1000, W, H)?.id).toBe("bottom");
    expect(hitTestLayers([bottom, top], 50, 50, W, H)).toBeNull();
  });

  it("hit-tests in the rotated frame, not the axis-aligned bounds", () => {
    const tall = rect({ id: "tall", width: 0.4, height: 0.02, rotation: 90 }); // a 400×40 bar, standing vertically
    expect(hitTestLayers([tall], 500, 1150, W, H)?.id).toBe("tall"); // along its length
    expect(hitTestLayers([tall], 650, 1000, W, H)).toBeNull(); // where it would be if unrotated
  });

  it("gives hairline shapes some grab slop", () => {
    const line = createShapeLayer("line", { id: "l", x: 0.5, y: 0.5, width: 0.4, height: 0.001 });
    expect(hitTestLayers([line], 500, 1004, W, H)?.id).toBe("l");
  });
});

describe("rotation helpers", () => {
  it("normalizes into -180..180 with one decimal", () => {
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-190)).toBe(170);
    expect(Math.abs(normalizeAngle(180.04))).toBe(180);
  });

  it("rotation from the handle pointer, with optional 15° snapping", () => {
    const box = { cx: 500, cy: 1000, w: 400, h: 200, rotation: 0 };
    expect(rotationFromPointer(box, { x: 500, y: 800 }, false)).toBe(0); // straight up = unrotated
    expect(rotationFromPointer(box, { x: 700, y: 1000 }, false)).toBe(90); // to the right = quarter turn clockwise
    expect(rotationFromPointer(box, { x: 700, y: 960 }, true)).toBe(75);
  });

  it("rotateVector is the inverse of toLocalPoint's rotation", () => {
    const v = rotateVector(10, 0, 30);
    expect(v.x).toBeCloseTo(10 * Math.cos(Math.PI / 6));
    expect(v.y).toBeCloseTo(10 * Math.sin(Math.PI / 6));
  });
});

describe("move helpers", () => {
  it("shift-drag locks to the dominant axis", () => {
    expect(constrainToAxis({ x: 0.5, y: 0.5 }, 0.1, 0.02, W, H)).toEqual({ x: 0.6, y: 0.5 });
    expect(constrainToAxis({ x: 0.5, y: 0.5 }, 0.01, 0.02, W, H)).toEqual({ x: 0.5, y: 0.52 });
  });

  it("snaps to the canvas centre within the threshold and reports which axes stuck", () => {
    expect(snapToCenter({ x: 0.503, y: 0.3 }, 8, W, H)).toEqual({ x: 0.5, y: 0.3, snappedX: true, snappedY: false });
    expect(snapToCenter({ x: 0.52, y: 0.5015 }, 8, W, H)).toEqual({ x: 0.52, y: 0.5, snappedX: false, snappedY: true });
    expect(snapToCenter({ x: 0.503, y: 0.5015 }, 0, W, H)).toMatchObject({ x: 0.503, y: 0.5015, snappedX: false, snappedY: false });
  });
});

describe("computeResize", () => {
  function resize(layer: Layer, handle: HandleId, dx: number, dy: number, shift = false) {
    const startBox = getLayerBox(layer, W, H);
    // Grab the handle at its own position, then move the pointer by (dx, dy) canvas px.
    const { sx, sy } = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] }[handle].reduce(
      (acc, v, i) => ({ ...acc, [i === 0 ? "sx" : "sy"]: v }),
      { sx: 0, sy: 0 },
    );
    const start = { x: startBox.cx + (sx * startBox.w) / 2, y: startBox.cy + (sy * startBox.h) / 2 };
    const patch = computeResize({ handle, start, startLayer: layer, startBox }, { x: start.x + dx, y: start.y + dy }, shift, W, H);
    return { patch, box: getLayerBox({ ...layer, ...patch } as Layer, W, H) };
  }

  it("dragging the east handle grows the width and keeps the west edge pinned", () => {
    const { box } = resize(rect(), "e", 100, 0);
    expect(box.w).toBeCloseTo(500);
    expect(box.cx - box.w / 2).toBeCloseTo(300); // left edge unchanged
    expect(box.h).toBeCloseTo(200);
  });

  it("dragging a corner changes both dimensions and pins the opposite corner", () => {
    const { box } = resize(rect(), "nw", -100, -50);
    expect(box.w).toBeCloseTo(500);
    expect(box.h).toBeCloseTo(250);
    expect(box.cx + box.w / 2).toBeCloseTo(700); // right edge
    expect(box.cy + box.h / 2).toBeCloseTo(1100); // bottom edge
  });

  it("never shrinks below the minimum size", () => {
    const { box } = resize(rect(), "e", -1000, 0);
    expect(box.w).toBeCloseTo(20);
  });

  it("works in the layer's rotated frame: a 90° box resized 'east' grows along screen-y", () => {
    const { box } = resize(rect({ rotation: 90 }), "e", 0, 100);
    expect(box.w).toBeCloseTo(500);
    expect(box.cy).toBeCloseTo(1050); // centre shifts half the growth, downwards
    expect(box.cx).toBeCloseTo(500);
  });

  it("image layers keep their aspect on corner drags unless Shift is held", () => {
    const image = createImageLayer("m", "img", 2, { x: 0.5, y: 0.5, width: 0.4, height: 0.1 }); // 400×200 px
    const locked = resize(image, "se", 100, 0).box;
    expect(locked.w / locked.h).toBeCloseTo(2);
    const free = resize(image, "se", 100, 0, true).box;
    expect(free.w).toBeCloseTo(500);
    expect(free.h).toBeCloseTo(200);
  });

  it("shapes are free by default and aspect-locked with Shift", () => {
    const locked = resize(rect(), "se", 100, 0, true).box;
    expect(locked.w / locked.h).toBeCloseTo(2);
  });

  it("text: side handles change only the wrap width, corners scale the type too", () => {
    const text = createTextLayer({ id: "t", x: 0.5, y: 0.5, width: 0.4, fontSize: 0.05 });
    const side = resize(text, "e", 100, 0).patch as Partial<TextLayer>;
    expect(side.width).toBeCloseTo(0.5);
    expect(side.fontSize).toBe(0.05);
    expect(side).not.toHaveProperty("height");
    const corner = resize(text, "se", 100, 0).patch as Partial<TextLayer>;
    expect(corner.width).toBeCloseTo(0.5);
    expect(corner.fontSize).toBeCloseTo(0.05 * 1.25);
  });
});
