import { describe, expect, it } from "vitest";
import { createDefaultDocument, createImageLayer, createTextLayer, referencedMediaIds } from "./document.js";
import { BUILT_IN_TEMPLATES, buildSavedTemplate, freshLayerIds, remapTemplateMedia, savedToTemplate } from "./templates.js";

describe("built-in templates", () => {
  it("have unique ids and names, a size, and no media dependencies", () => {
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(BUILT_IN_TEMPLATES.length);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.name)).size).toBe(BUILT_IN_TEMPLATES.length);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.builtIn).toBe(true);
      expect(template.config.canvas.width).toBeGreaterThan(0);
      expect(referencedMediaIds(template.config)).toEqual([]);
    }
  });

  it("include the Instagram story preset at 1080×1920", () => {
    const story = BUILT_IN_TEMPLATES.find((t) => t.name === "Instagram Story");
    expect(story?.config.canvas).toEqual({ aspectId: "9:16", width: 1080, height: 1920 });
    expect(story?.config.layers.length).toBeGreaterThan(0);
  });
});

describe("saved templates", () => {
  it("reference shared media by id instead of copying blobs", () => {
    const doc = { ...createDefaultDocument(), sourceMediaId: "photo-hash", layers: [createImageLayer("logo-hash", "Logo", 1)] };
    const saved = buildSavedTemplate("Brand", doc, "data:image/jpeg;base64,AAA");
    expect(saved.name).toBe("Brand");
    expect(saved).not.toHaveProperty("media");
    expect(referencedMediaIds(saved.config)).toEqual(["logo-hash"]);
    expect(savedToTemplate(saved)).toMatchObject({ builtIn: false, media: {} });
  });

  it("remaps media ids (for templates that carried their own copies)", () => {
    const config = buildSavedTemplate(
      "x",
      {
        ...createDefaultDocument(),
        background: { mode: "image", color: "#000", blur: 0, mediaId: "old-bg" },
        layers: [createImageLayer("old-logo", "Logo", 1), createTextLayer()],
      },
      null,
    ).config;
    const remapped = remapTemplateMedia(
      config,
      new Map([
        ["old-logo", "new-logo"],
        ["old-bg", "new-bg"],
      ]),
    );
    expect(referencedMediaIds(remapped).sort()).toEqual(["new-bg", "new-logo"]);
    expect(remapped.layers[1].kind).toBe("text");
  });

  it("gives layers fresh ids on every application", () => {
    const config = buildSavedTemplate("x", { ...createDefaultDocument(), layers: [createTextLayer({ id: "fixed" })] }, null).config;
    const a = freshLayerIds(config);
    const b = freshLayerIds(config);
    expect(a.layers[0].id).not.toBe("fixed");
    expect(a.layers[0].id).not.toBe(b.layers[0].id);
  });
});
