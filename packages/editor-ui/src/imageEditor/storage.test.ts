import { describe, expect, it } from "vitest";
import {
  deleteImageProject,
  listImageMediaIds,
  listImageProjects,
  loadImageMediaBlob,
  loadImageProject,
  saveImageMediaBlob,
  saveImageProject,
  saveImageTemplate,
  saveImageToGallery,
  type ImageProjectRecord,
} from "../persistence/db.js";
import { createDefaultDocument, createImageLayer, createTextLayer, type ImageDocument } from "./document.js";
import { buildSavedTemplate } from "./templates.js";
import {
  analyzeImageStorage,
  collectReferencedMediaIds,
  deleteImageProjectAndMedia,
  documentBytes,
  duplicateImageProject,
  formatBytes,
  hashBlob,
  listImageProjectsWithMigration,
  purgeUnreferencedMedia,
} from "./storage.js";

function blobOf(bytes: number, fill = "a"): Blob {
  return new Blob([fill.repeat(bytes)], { type: "image/png" });
}

function project(id: string, doc: ImageDocument, extra: Partial<ImageProjectRecord> = {}): ImageProjectRecord {
  return { id, name: id, doc, createdAt: 1, updatedAt: 1, thumbnail: null, ...extra };
}

describe("content-addressed media ids", () => {
  it("are a stable SHA-256 of the bytes — same file, same id", async () => {
    const a = await hashBlob(blobOf(100));
    const b = await hashBlob(new Blob(["a".repeat(100)]));
    const c = await hashBlob(blobOf(100, "b"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("image projects", () => {
  it("save, list (newest first), load and delete", async () => {
    await saveImageProject(project("one", createDefaultDocument(), { updatedAt: 10 }));
    await saveImageProject(project("two", createDefaultDocument(), { updatedAt: 20 }));
    expect((await listImageProjects()).map((p) => p.id)).toEqual(["two", "one"]);
    expect((await loadImageProject("one"))?.name).toBe("one");
    await deleteImageProject("one");
    expect(await loadImageProject("one")).toBeNull();
    expect((await listImageProjects()).map((p) => p.id)).toEqual(["two"]);
  });

  it("duplicating copies the document under a new id and name, sharing the media", async () => {
    const doc = { ...createDefaultDocument(), sourceMediaId: "photo", layers: [createTextLayer({ text: "hello" })] };
    await saveImageProject(project("src", doc, { name: "Poster" }));
    const copy = await duplicateImageProject("src");
    expect(copy?.id).not.toBe("src");
    expect(copy?.name).toBe("Poster copy");
    expect(copy?.doc).toEqual(doc);
    expect((await listImageProjects()).length).toBe(2);
    expect(await duplicateImageProject("missing")).toBeNull();
  });

  it("migrates a v5 single-slot document into a named project exactly once", async () => {
    // Write the legacy record the way v5 did (store "imageProject", key "current").
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("reel-studio", 6);
      req.onupgradeneeded = () => {
        for (const name of ["project", "media", "audioProject", "audioMedia", "imageProject", "imageMedia"])
          req.result.createObjectStore(name);
        for (const name of ["savedImages", "savedAudio", "imageTemplates", "imageProjects"])
          req.result.createObjectStore(name, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const legacyDoc = { ...createDefaultDocument(), sourceName: "holiday" };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("imageProject", "readwrite");
      tx.objectStore("imageProject").put({ doc: legacyDoc, savedAt: 123 }, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const first = await listImageProjectsWithMigration();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: "holiday", createdAt: 123, updatedAt: 123 });
    expect(first[0].doc).toEqual(legacyDoc);
    expect(await listImageProjectsWithMigration()).toHaveLength(1);
  });
});

describe("shared media lifecycle", () => {
  const photo = blobOf(5000, "p");
  const logo = blobOf(300, "l");
  const stray = blobOf(700, "s");

  async function seed() {
    const [photoId, logoId, strayId] = await Promise.all([hashBlob(photo), hashBlob(logo), hashBlob(stray)]);
    await saveImageMediaBlob(photoId, photo);
    await saveImageMediaBlob(logoId, logo);
    await saveImageMediaBlob(strayId, stray);
    await saveImageProject(
      project("a", { ...createDefaultDocument(), sourceMediaId: photoId, layers: [createImageLayer(logoId, "Logo", 1)] }),
    );
    await saveImageProject(project("b", { ...createDefaultDocument(), sourceMediaId: photoId }));
    return { photoId, logoId, strayId };
  }

  it("collects the ids every project and template still needs", async () => {
    const { photoId, logoId } = await seed();
    await saveImageTemplate(
      buildSavedTemplate("brand", { ...createDefaultDocument(), layers: [createImageLayer("template-only", "x", 1)] }, null),
    );
    expect(Array.from(await collectReferencedMediaIds()).sort()).toEqual([logoId, photoId, "template-only"].sort());
  });

  it("purge removes only what nothing references, and reports what it freed", async () => {
    const { photoId, logoId, strayId } = await seed();
    const result = await purgeUnreferencedMedia();
    expect(result).toEqual({ deleted: 1, bytes: 700 });
    expect((await listImageMediaIds()).sort()).toEqual([logoId, photoId].sort());
    expect(await loadImageMediaBlob(strayId)).toBeNull();
  });

  it("purge keeps ids an open editor asks to protect", async () => {
    const { strayId } = await seed();
    await purgeUnreferencedMedia([strayId]);
    expect(await loadImageMediaBlob(strayId)).not.toBeNull();
  });

  it("deleting a project frees its exclusive media but keeps what another project shares", async () => {
    const { photoId, logoId } = await seed();
    await deleteImageProjectAndMedia("a");
    expect(await loadImageMediaBlob(logoId)).toBeNull(); // only "a" used the logo
    expect(await loadImageMediaBlob(photoId)).not.toBeNull(); // "b" still uses the photo
    await deleteImageProjectAndMedia("b");
    expect(await listImageMediaIds()).toEqual([]);
  });
});

describe("storage analysis", () => {
  it("attributes bytes to projects, counts shared and unused media, and totals the rest", async () => {
    const photo = blobOf(5000, "p");
    const logo = blobOf(300, "l");
    const photoId = await hashBlob(photo);
    const logoId = await hashBlob(logo);
    await saveImageMediaBlob(photoId, photo);
    await saveImageMediaBlob(logoId, logo);
    await saveImageMediaBlob("orphan", blobOf(700));
    const docA = { ...createDefaultDocument(), sourceMediaId: photoId, layers: [createImageLayer(logoId, "Logo", 1), createTextLayer()] };
    const docB = { ...createDefaultDocument(), sourceMediaId: photoId };
    await saveImageProject(project("a", docA, { thumbnail: blobOf(40) }));
    await saveImageProject(project("b", docB));
    await saveImageToGallery({ id: "g", name: "g", blob: blobOf(1234), width: 1, height: 1, format: "png", savedAt: 1 });

    const report = await analyzeImageStorage();
    const a = report.projects.find((p) => p.id === "a")!;
    const b = report.projects.find((p) => p.id === "b")!;
    expect(a).toMatchObject({
      docBytes: documentBytes(docA),
      thumbnailBytes: 40,
      mediaBytes: 5300,
      exclusiveMediaBytes: 300,
      mediaCount: 2,
      layerCount: 2,
    });
    expect(b).toMatchObject({ mediaBytes: 5000, exclusiveMediaBytes: 0, mediaCount: 1, layerCount: 0 });
    expect(report.media).toEqual({ count: 3, bytes: 6000, sharedCount: 1, unusedCount: 1, unusedBytes: 700 });
    // With a private copy per project the photo would be stored twice: 5300 + 5000.
    expect(report.mediaBytesIfCopied).toBe(10300);
    expect(report.other.savedImages).toBe(1234);
    expect(report.imageEditorBytes).toBe(6000 + a.docBytes + 40 + b.docBytes);
    expect(report.totalBytes).toBe(report.imageEditorBytes + 1234);
  });

  it("formats byte counts for humans", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.50 MB");
  });
});
