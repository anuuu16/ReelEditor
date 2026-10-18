import { describe, expect, it } from "vitest";
import {
  applyTemplateConfig,
  createDefaultDocument,
  createImageLayer,
  createShapeLayer,
  createStickerLayer,
  createTextLayer,
  duplicateLayer,
  extractTemplateConfig,
  hasTransparency,
  moveLayer,
  normalizeDocument,
  normalizeLayer,
  referencedMediaIds,
  reorderLayer,
  updateLayer,
  type ImageDocument,
  type Layer,
  type TextLayer,
} from "./document.js";

function docWith(layers: Layer[], extra: Partial<ImageDocument> = {}): ImageDocument {
  return { ...createDefaultDocument(), layers, ...extra };
}

describe("layer factories", () => {
  it("give every layer a unique id and the shared defaults", () => {
    const a = createTextLayer();
    const b = createShapeLayer("rectangle");
    const c = createImageLayer("media-1", "Logo", 2);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    for (const layer of [a, b, c]) {
      expect(layer).toMatchObject({
        x: 0.5,
        y: 0.5,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        visible: true,
        locked: false,
        flipH: false,
        flipV: false,
      });
    }
  });

  it("sizes an image layer's box from the image's aspect", () => {
    const wide = createImageLayer("m", "wide", 2);
    expect(wide.height).toBeCloseTo(wide.width / 2);
  });

  it("makes lines stroke-only and filled shapes fill-only by default", () => {
    expect(createShapeLayer("line")).toMatchObject({ fill: null, stroke: "#ffffff" });
    expect(createShapeLayer("ellipse")).toMatchObject({ fill: "#5b7cff", stroke: null });
  });

  it("stickers are big emoji text layers without a shadow", () => {
    const sticker = createStickerLayer("🔥");
    expect(sticker).toMatchObject({ kind: "text", text: "🔥", fontFamily: "emoji", shadow: null });
    expect(sticker.fontSize).toBeGreaterThan(createTextLayer().fontSize);
  });
});

describe("layer ordering", () => {
  const [a, b, c] = [
    createShapeLayer("rectangle", { id: "a" }),
    createShapeLayer("rectangle", { id: "b" }),
    createShapeLayer("rectangle", { id: "c" }),
  ];
  const ids = (layers: Layer[]) => layers.map((l) => l.id);

  it("moves one step up/down and straight to the top/bottom", () => {
    expect(ids(moveLayer([a, b, c], "a", "up"))).toEqual(["b", "a", "c"]);
    expect(ids(moveLayer([a, b, c], "c", "down"))).toEqual(["a", "c", "b"]);
    expect(ids(moveLayer([a, b, c], "a", "top"))).toEqual(["b", "c", "a"]);
    expect(ids(moveLayer([a, b, c], "c", "bottom"))).toEqual(["c", "a", "b"]);
  });

  it("returns the same array when nothing can move", () => {
    const layers = [a, b, c];
    expect(moveLayer(layers, "c", "up")).toBe(layers);
    expect(moveLayer(layers, "a", "down")).toBe(layers);
    expect(moveLayer(layers, "missing", "up")).toBe(layers);
  });

  it("reorders to an explicit index, clamped to the list", () => {
    expect(ids(reorderLayer([a, b, c], "a", 2))).toEqual(["b", "c", "a"]);
    expect(ids(reorderLayer([a, b, c], "c", 0))).toEqual(["c", "a", "b"]);
    expect(ids(reorderLayer([a, b, c], "c", 99))).toEqual(["a", "b", "c"]);
  });

  it("duplicates right above the source, nudged so it's visibly a copy", () => {
    const { layers, newId } = duplicateLayer([a, b, c], "a");
    expect(newId).not.toBeNull();
    expect(ids(layers)).toEqual(["a", newId, "b", "c"]);
    const copy = layers[1];
    expect(copy.name).toBe("Rectangle copy");
    expect(copy.x).toBeCloseTo(a.x + 0.03);
  });

  it("patches only the targeted layer", () => {
    const next = updateLayer([a, b], "b", { opacity: 0.5 });
    expect(next[0]).toBe(a);
    expect(next[1].opacity).toBe(0.5);
  });
});

describe("templates", () => {
  it("a template keeps the look but not the photo, crop or orientation", () => {
    const doc = docWith([createTextLayer({ id: "t" })], {
      sourceMediaId: "photo-hash",
      photo: {
        ...createDefaultDocument().photo,
        crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        rotation: 90,
        flipH: true,
        zoom: 1.4,
        fitMode: "fill",
      },
      frame: { borderWidth: 10, borderColor: "#fff", cornerRadius: 20, matte: "#fff" },
    });
    const config = extractTemplateConfig(doc);
    expect(config).not.toHaveProperty("sourceMediaId");
    expect(config.photo).toEqual({
      fitMode: "fill",
      zoom: 1.4,
      offsetX: 0,
      offsetY: 0,
      filter: doc.photo.filter,
      extras: doc.photo.extras,
    });
    expect(config.photo).not.toHaveProperty("crop");
    expect(config.frame.cornerRadius).toBe(20);
  });

  it("applying a template onto another document keeps that document's photo and crop", () => {
    const source = docWith([createShapeLayer("star", { id: "s" })], {
      frame: { borderWidth: 5, borderColor: "#000", cornerRadius: 50, matte: null },
    });
    const target = docWith([createTextLayer({ id: "old" })], {
      sourceMediaId: "other-photo",
      photo: { ...createDefaultDocument().photo, crop: { x: 0, y: 0, width: 0.3, height: 0.3 }, rotation: 180 },
    });
    const result = applyTemplateConfig(target, extractTemplateConfig(source));
    expect(result.sourceMediaId).toBe("other-photo");
    expect(result.photo.crop).toEqual({ x: 0, y: 0, width: 0.3, height: 0.3 });
    expect(result.photo.rotation).toBe(180);
    expect(result.layers.map((l) => l.id)).toEqual(["s"]);
    expect(result.frame.cornerRadius).toBe(50);
  });

  it("lists every media id a document or template refers to", () => {
    const doc = docWith([createImageLayer("logo", "Logo", 1), createTextLayer()], {
      sourceMediaId: "photo",
      background: { mode: "image", color: "#000", blur: 0, mediaId: "bg" },
    });
    expect(referencedMediaIds(doc).sort()).toEqual(["bg", "logo", "photo"]);
    expect(referencedMediaIds(extractTemplateConfig(doc)).sort()).toEqual(["bg", "logo"]);
  });
});

describe("hasTransparency", () => {
  it("is true for rounded corners or a transparent background, false otherwise", () => {
    const doc = createDefaultDocument();
    expect(hasTransparency(doc)).toBe(false);
    expect(hasTransparency({ ...doc, frame: { ...doc.frame, cornerRadius: 10 } })).toBe(true);
    expect(hasTransparency({ ...doc, background: { ...doc.background, mode: "transparent" } })).toBe(true);
  });
});

describe("normalization of older records", () => {
  it("migrates a text layer's legacy shadowColor/shadowBlur into `shadow`", () => {
    const legacy = { ...createTextLayer({ id: "t" }), shadowColor: "rgba(1,2,3,0.4)", shadowBlur: 0.02 } as unknown as TextLayer;
    delete (legacy as Partial<TextLayer>).shadow;
    const normalized = normalizeLayer(legacy) as TextLayer;
    expect(normalized.shadow).toEqual({ color: "rgba(1,2,3,0.4)", blur: 0.02, offsetX: 0, offsetY: 0.004 });
    expect(normalized).not.toHaveProperty("shadowColor");
  });

  it("fills in fields a stored document predates without touching what it has", () => {
    const stored = createDefaultDocument();
    delete (stored.layers as unknown as Record<string, unknown>)["x"];
    const partial = { ...stored, frame: { borderWidth: 3 } } as unknown as ImageDocument;
    const normalized = normalizeDocument(partial);
    expect(normalized.frame).toEqual({ borderWidth: 3, borderColor: "#ffffff", cornerRadius: 0, matte: null });
    expect(normalized.layers).toEqual([]);
  });
});
