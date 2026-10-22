import { describe, expect, it } from "vitest";
import type { ProjectModel } from "@reel-studio/shared-types";
import { createInitialProject } from "../state/initialProject.js";
import { loadProject, saveMediaBlob } from "./db.js";
import { pickFreshestProject, saveLocalSnapshot } from "./localSnapshot.js";

function project(id: string, updatedAt: number, name = "p"): ProjectModel {
  const base = createInitialProject();
  return { ...base, id, metadata: { ...base.metadata, name, updatedAt } };
}

describe("local autosave snapshot", () => {
  it("stamps the snapshot with when it was taken", async () => {
    const before = Date.now();
    await saveLocalSnapshot(project("a", 0));
    const saved = await loadProject();
    expect(saved?.metadata.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("keeps the server's copy when it's at least as fresh, or when the snapshot is another project", async () => {
    await saveLocalSnapshot(project("a", 0, "local"));
    const snapshotTime = (await loadProject())!.metadata.updatedAt;
    const fromServer = project("a", snapshotTime + 1, "server");
    expect((await pickFreshestProject("a", fromServer))?.metadata.name).toBe("server");
    const other = project("b", 0, "other");
    expect((await pickFreshestProject("b", other))?.metadata.name).toBe("other");
    expect(await pickFreshestProject("b", null)).toBeNull();
  });

  it("prefers the snapshot when it's newer than the server's copy, with its media hydrated", async () => {
    const blob = new Blob(["video-bytes"]);
    await saveMediaBlob("src-1", blob);
    const local = project("a", 0, "local");
    local.sources = [
      {
        id: "src-1",
        name: "clip.webm",
        filePath: "",
        previewUrl: "",
        durationSeconds: 4,
        width: 16,
        height: 16,
        kind: "video",
        isPlaceholder: false,
      },
      {
        id: "gone",
        name: "lost.webm",
        filePath: "",
        previewUrl: "",
        durationSeconds: 4,
        width: 16,
        height: 16,
        kind: "video",
        isPlaceholder: false,
      },
    ];
    await saveLocalSnapshot(local);
    const stale = project("a", 1, "server"); // saved long before the snapshot
    const picked = (await pickFreshestProject("a", stale))!;
    expect(picked.metadata.name).toBe("local");
    expect(picked.sources[0].previewUrl).toMatch(/^blob:/);
    expect(picked.sources[1].previewUrl).toBe(""); // its file isn't stored: re-import, as before
  });

  it("is the only copy there is when a project is reloaded before its first save reached the server", async () => {
    await saveLocalSnapshot(project("new", 0, "unsaved"));
    expect((await pickFreshestProject("new", null))?.metadata.name).toBe("unsaved");
  });
});
