import { describe, expect, it } from "vitest";
import {
  baseName,
  batchFileName,
  buildBatchDocument,
  collectOutputs,
  runBatch,
  safeFileName,
  uniqueFileNames,
  type BatchItem,
} from "./batch.js";
import { createDefaultDocument, createTextLayer, extractTemplateConfig, originalDocument } from "./document.js";

const vars = { name: "IMG_0042", index: 3, total: 12, template: "Instagram Story", width: 1080, height: 1920 };

describe("file naming", () => {
  it("strips extensions and sanitizes characters no file system accepts", () => {
    expect(baseName("holiday.final.JPG")).toBe("holiday.final");
    expect(baseName(".hidden")).toBe("image");
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(safeFileName("   ")).toBe("image");
  });

  it("expands every token and pads the index to the batch size", () => {
    expect(batchFileName("{name}-{template}", vars, "png")).toBe("IMG_0042-Instagram Story.png");
    expect(batchFileName("{index}_{name}", vars, "jpeg")).toBe("03_IMG_0042.jpg");
    expect(batchFileName("{index}", { ...vars, total: 250 }, "webp")).toBe("003.webp");
    expect(batchFileName("{width}x{height}", vars, "png")).toBe("1080x1920.png");
    expect(batchFileName("{date}", vars, "png")).toMatch(/^\d{4}-\d{2}-\d{2}\.png$/);
  });

  it("falls back to the default pattern when the pattern is blank", () => {
    expect(batchFileName("   ", vars, "png")).toBe("IMG_0042-Instagram Story.png");
  });

  it("makes duplicate names unique without touching the first", () => {
    expect(uniqueFileNames(["a.png", "b.png", "a.png", "a.png"])).toEqual(["a.png", "b.png", "a (2).png", "a (3).png"]);
  });
});

describe("buildBatchDocument", () => {
  it("applies the template's look to a fresh document holding that photo", () => {
    const source = {
      ...createDefaultDocument(),
      layers: [createTextLayer({ id: "t", text: "SALE" })],
      canvas: { aspectId: "1:1", width: 800, height: 800 },
    };
    const doc = buildBatchDocument(extractTemplateConfig(source), "photo-1", "beach");
    expect(doc.sourceMediaId).toBe("photo-1");
    expect(doc.sourceName).toBe("beach");
    expect(doc.canvas).toEqual({ aspectId: "1:1", width: 800, height: 800 });
    expect(doc.layers.map((l) => l.kind)).toEqual(["text"]);
    expect(doc.photo.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("originalDocument (the 'before')", () => {
  it("keeps only the photo and the frame size", () => {
    const edited = {
      ...createDefaultDocument(),
      sourceMediaId: "p",
      sourceName: "n",
      canvas: { aspectId: "custom", width: 600, height: 400 },
      layers: [createTextLayer()],
      frame: { borderWidth: 20, borderColor: "#f00", cornerRadius: 30, matte: "#fff" },
      photo: { ...createDefaultDocument().photo, rotation: 90 as const, zoom: 2, crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } },
      watermark: { ...createDefaultDocument().watermark, text: "©" },
    };
    const before = originalDocument(edited);
    expect(before.sourceMediaId).toBe("p");
    expect(before.canvas).toEqual(edited.canvas);
    expect(before.layers).toEqual([]);
    expect(before.frame).toEqual(createDefaultDocument().frame);
    expect(before.photo).toEqual(createDefaultDocument().photo);
    expect(before.watermark.text).toBe("");
  });
});

function item(id: string, name = id): BatchItem {
  return { id, name, file: new Blob([id]), status: "pending" };
}

describe("runBatch", () => {
  it("renders items in order, reporting progress after each step", async () => {
    const order: string[] = [];
    const progress: Array<[number, number]> = [];
    const result = await runBatch([item("a"), item("b"), item("c")], {
      render: async (i) => {
        order.push(i.id);
        return new Blob([`out-${i.id}`]);
      },
      onProgress: (_items, done, total) => progress.push([done, total]),
    });
    expect(order).toEqual(["a", "b", "c"]);
    expect(result.map((i) => i.status)).toEqual(["done", "done", "done"]);
    expect(result[1].output?.size).toBe("out-b".length);
    expect(progress.at(-1)).toEqual([3, 3]);
    expect(progress[0]).toEqual([0, 3]); // first report: "a" is rendering, nothing done yet
  });

  it("one failure doesn't stop the rest and is recorded on the item", async () => {
    const result = await runBatch([item("ok1"), item("bad"), item("ok2")], {
      render: async (i) => {
        if (i.id === "bad") throw new Error("decode failed");
        return new Blob(["x"]);
      },
    });
    expect(result.map((i) => i.status)).toEqual(["done", "error", "done"]);
    expect(result[1].error).toBe("decode failed");
    expect(result[1].output).toBeUndefined();
  });

  it("aborting marks everything not yet rendered as skipped", async () => {
    const controller = new AbortController();
    const result = await runBatch([item("a"), item("b"), item("c")], {
      signal: controller.signal,
      render: async (i) => {
        if (i.id === "a") controller.abort();
        return new Blob(["x"]);
      },
    });
    expect(result.map((i) => i.status)).toEqual(["done", "skipped", "skipped"]);
  });

  it("skips items that are already done and re-runs the rest", async () => {
    const rendered: string[] = [];
    const result = await runBatch(
      [
        { ...item("a"), status: "done", output: new Blob(["old"]) },
        { ...item("b"), status: "error", error: "x" },
      ],
      {
        render: async (i) => {
          rendered.push(i.id);
          return new Blob(["new"]);
        },
      },
    );
    expect(rendered).toEqual(["b"]);
    expect(result[0].output?.size).toBe(3);
    expect(result[1]).toMatchObject({ status: "done", error: undefined });
  });
});

describe("collectOutputs", () => {
  it("pairs finished items with unique, numbered file names and drops failures", () => {
    const items: BatchItem[] = [
      { ...item("1", "dup"), status: "done", output: new Blob(["a"]) },
      { ...item("2", "bad"), status: "error", error: "boom" },
      { ...item("3", "dup"), status: "done", output: new Blob(["b"]) },
    ];
    const outputs = collectOutputs(items, { format: "png", quality: 1, namePattern: "{index}-{name}" }, "Look", { width: 10, height: 10 });
    expect(outputs.map((o) => o.name)).toEqual(["01-dup.png", "03-dup.png"]);
    const same = collectOutputs(items, { format: "png", quality: 1, namePattern: "{name}" }, "Look", { width: 10, height: 10 });
    expect(same.map((o) => o.name)).toEqual(["dup.png", "dup (2).png"]);
  });
});
