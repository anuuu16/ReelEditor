// Saving a project through the API: the files an upload leaves behind when the save is rejected,
// and the ones a successful save should take with it (media nothing refers to any more).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectModel } from "@reel-studio/shared-types";
import { app, jobsRestored } from "./app.js";
import { mediaDir, projectDir, PROJECTS_ROOT } from "./projects.js";

let baseUrl = "";
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  await jobsRestored;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function project(id: string, sourceIds: string[]): ProjectModel {
  return {
    id,
    canvas: { aspectRatio: "9:16", width: 1080, height: 1920, frameRate: 30 },
    tracks: [{ id: "video-track", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }],
    clips: [],
    overlays: [],
    sources: sourceIds.map((sid) => ({
      id: sid,
      name: `${sid}.mp4`,
      filePath: "",
      previewUrl: "",
      durationSeconds: 1,
      width: 16,
      height: 16,
      kind: "video" as const,
      isPlaceholder: false,
    })),
    endBehavior: "black",
    metadata: { name: "p", templateId: null, isTemplate: false, createdAt: 0, updatedAt: 0, thumbnailDataUrl: null },
  };
}

function save(projectId: string, body: string, files: Record<string, string> = {}): Promise<Response> {
  const form = new FormData();
  form.append("project", body);
  for (const [sourceId, content] of Object.entries(files)) form.append(`media_${sourceId}`, new Blob([content]), `${sourceId}.mp4`);
  return fetch(`${baseUrl}/projects/${projectId}`, { method: "POST", body: form });
}

const settle = () => new Promise((r) => setTimeout(r, 150));

describe("POST /projects/:id — upload hygiene", () => {
  it("uses a temp projects folder in tests", () => {
    expect(PROJECTS_ROOT).toContain("reel-studio-test-projects-");
  });

  it("a rejected save of a project that doesn't exist leaves no folder behind", async () => {
    const id = randomUUID();
    const response = await save(id, "{not json", { a: "bytes" });
    expect(response.status).toBe(400);
    await settle();
    expect(existsSync(projectDir(id))).toBe(false);
  });

  it("a rejected save of an existing project takes only its own files back out", async () => {
    const id = randomUUID();
    expect((await save(id, JSON.stringify(project(id, ["keep"])), { keep: "bytes" })).status).toBe(200);
    expect(readdirSync(mediaDir(id))).toEqual(["keep.mp4"]);

    const response = await save(id, '{"sources": "nope"}', { intruder: "bytes" });
    expect(response.status).toBe(400);
    await settle();
    expect(readdirSync(mediaDir(id))).toEqual(["keep.mp4"]);
    expect(existsSync(path.join(projectDir(id), "project.json"))).toBe(true);
  });

  it("a successful save prunes media no source refers to any more, and nothing else", async () => {
    const id = randomUUID();
    expect((await save(id, JSON.stringify(project(id, ["a", "b"])), { a: "A", b: "B" })).status).toBe(200);
    // A stray file with an id that isn't a source, and one for a source that's still listed but
    // wasn't re-uploaded this time (unused on the timeline — the editor only uploads what's used).
    mkdirSync(mediaDir(id), { recursive: true });
    writeFileSync(path.join(mediaDir(id), "stale.mp4"), "S");

    expect((await save(id, JSON.stringify(project(id, ["a", "b"])), { a: "A" })).status).toBe(200);
    expect(readdirSync(mediaDir(id)).sort()).toEqual(["a.mp4", "b.mp4"]);

    // Source b removed from the project: its file goes on the next save.
    expect((await save(id, JSON.stringify(project(id, ["a"])), { a: "A" })).status).toBe(200);
    expect(readdirSync(mediaDir(id))).toEqual(["a.mp4"]);
  });

  it("lists what it has (with fingerprints), so a save can leave out files it already holds", async () => {
    const id = randomUUID();
    expect((await save(id, JSON.stringify(project(id, ["a", "b"])), { a: "AAAA", b: "BB" })).status).toBe(200);
    const listing = (await (await fetch(`${baseUrl}/projects/${id}/media`)).json()) as Record<
      string,
      { bytes: number; fingerprint: string }
    >;
    expect(Object.keys(listing).sort()).toEqual(["a", "b"]);
    expect(listing.a.bytes).toBe(4);
    expect(listing.a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(listing.a.fingerprint).not.toBe(listing.b.fingerprint);

    // The next save sends the JSON only: both files stay, and the listing is unchanged.
    expect((await save(id, JSON.stringify(project(id, ["a", "b"])))).status).toBe(200);
    expect(readdirSync(mediaDir(id)).sort()).toEqual(["a.mp4", "b.mp4"]);
    expect(await (await fetch(`${baseUrl}/projects/${id}/media`)).json()).toEqual(listing);

    // A project that was never saved has nothing to offer.
    expect(await (await fetch(`${baseUrl}/projects/${randomUUID()}/media`)).json()).toEqual({});
  });

  it("still serves, lists and deletes projects as before", async () => {
    const id = randomUUID();
    await save(id, JSON.stringify(project(id, ["a"])), { a: "A" });
    expect(((await (await fetch(`${baseUrl}/projects/${id}`)).json()) as ProjectModel).id).toBe(id);
    expect(await (await fetch(`${baseUrl}/projects/${id}/media/a`)).text()).toBe("A");
    expect((await fetch(`${baseUrl}/projects/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(existsSync(projectDir(id))).toBe(false);
  });
});
