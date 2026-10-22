import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectModel } from "@reel-studio/shared-types";
import { clearFingerprintCacheForTests, fingerprintBlob } from "../media/mediaFingerprint.js";
import { createInitialProject, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { startExport } from "../export/exportApi.js";
import { saveMediaBlob } from "./db.js";
import { planMediaUpload, saveProjectToServer } from "./projectServer.js";

// jsdom's FormData refuses the Node Blob the test setup swaps in (see test/setup.ts).
class FakeFormData {
  readonly entries = new Map<string, unknown>();
  append(name: string, value: unknown) {
    this.entries.set(name, value);
  }
  get(name: string) {
    return this.entries.get(name) ?? null;
  }
  keys() {
    return this.entries.keys();
  }
}

function clipOf(sourceId: string) {
  return {
    id: `clip-${sourceId}`,
    sourceId,
    trackId: VIDEO_TRACK_ID,
    label: "",
    inPoint: 0,
    outPoint: 4,
    timelineStart: 0,
    fitMode: "fit" as const,
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    volume: 1,
    muted: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    speed: 1,
    opacity: 1,
    filter: { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
    transitionOutSeconds: 0,
    transitionOutType: "dissolve" as const,
    gapBeforeSeconds: 0,
  };
}

function projectUsing(...sourceIds: string[]): ProjectModel {
  const base = createInitialProject();
  return {
    ...base,
    id: "proj-1",
    sources: sourceIds.map((id) => ({
      id,
      name: `${id}.webm`,
      filePath: "",
      previewUrl: "",
      durationSeconds: 4,
      width: 16,
      height: 16,
      kind: "video" as const,
      isPlaceholder: false,
    })),
    clips: sourceIds.map(clipOf),
  };
}

const BYTES_A = new Uint8Array(300).fill(1);
const BYTES_B = new Uint8Array(200).fill(2);

describe("planMediaUpload", () => {
  beforeEach(async () => {
    clearFingerprintCacheForTests();
    await saveMediaBlob("a", new Blob([BYTES_A]));
    await saveMediaBlob("b", new Blob([BYTES_B]));
  });

  it("uploads what the service lacks or has differently, refers to what it has, reports what's lost", async () => {
    const fpA = await fingerprintBlob(new Blob([BYTES_A]));
    const project = projectUsing("a", "b", "lost");
    const plan = await planMediaUpload(project, { a: { bytes: 300, fingerprint: fpA }, b: { bytes: 200, fingerprint: "different" } });
    expect(plan.refs).toEqual({ a: fpA });
    expect(plan.upload.map((u) => u.sourceId)).toEqual(["b"]);
    expect(plan.missing).toEqual(["lost"]);
  });

  it("skips the fingerprint entirely when the size already differs, and honours a forced upload", async () => {
    const fpA = await fingerprintBlob(new Blob([BYTES_A]));
    const project = projectUsing("a", "b");
    const wrongSize = await planMediaUpload(project, { a: { bytes: 299, fingerprint: fpA } });
    expect(wrongSize.upload.map((u) => u.sourceId)).toEqual(["a", "b"]);
    const forced = await planMediaUpload(project, { a: { bytes: 300, fingerprint: fpA } }, new Set(["a"]));
    expect(forced.upload.map((u) => u.sourceId)).toEqual(["a", "b"]);
    expect(forced.refs).toEqual({});
  });
});

describe("uploading only what's new", () => {
  const fetchMock = vi.fn();
  beforeEach(async () => {
    clearFingerprintCacheForTests();
    vi.stubGlobal("FormData", FakeFormData);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await saveMediaBlob("a", new Blob([BYTES_A]));
    await saveMediaBlob("b", new Blob([BYTES_B]));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a save sends only the media the service doesn't already hold", async () => {
    const fpA = await fingerprintBlob(new Blob([BYTES_A]));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/projects/proj-1/media"))
        return new Response(JSON.stringify({ a: { bytes: 300, fingerprint: fpA } }), { status: 200 });
      if (url.endsWith("/projects/proj-1") && init?.method === "POST")
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    await saveProjectToServer(projectUsing("a", "b"));
    const save = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/projects/proj-1"))!;
    const form = (save[1] as RequestInit).body as unknown as FakeFormData;
    expect([...form.keys()]).toEqual(["project", "media_b"]);
  });

  it("a save uploads everything when the project was never saved (or the listing fails)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/projects/proj-1/media")) return new Response("Not found", { status: 404 });
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    await saveProjectToServer(projectUsing("a", "b"));
    const save = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/projects/proj-1"))!;
    expect([...((save[1] as RequestInit).body as unknown as FakeFormData).keys()]).toEqual(["project", "media_a", "media_b"]);
  });

  it("an export refers to stored media, and falls back to uploading what the service says it's missing", async () => {
    const fpA = await fingerprintBlob(new Blob([BYTES_A]));
    const fpB = await fingerprintBlob(new Blob([BYTES_B]));
    const renderBodies: FakeFormData[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/projects/proj-1/media")) {
        return new Response(JSON.stringify({ a: { bytes: 300, fingerprint: fpA }, b: { bytes: 200, fingerprint: fpB } }), { status: 200 });
      }
      if (url.endsWith("/render")) {
        const form = init!.body as unknown as FakeFormData;
        renderBodies.push(form);
        if (renderBodies.length === 1) {
          return new Response(JSON.stringify({ error: "stale", missingSourceIds: ["b"] }), { status: 409 });
        }
        return new Response(JSON.stringify({ jobs: [{ id: "job-1" }] }), { status: 202 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const jobs = await startExport(projectUsing("a", "b"), [{ width: 180, height: 320, format: "mp4", label: null }]);
    expect(jobs).toEqual([{ id: "job-1" }]);
    expect(renderBodies).toHaveLength(2);
    expect([...renderBodies[0].keys()]).toEqual(["project", "outputs", "mediaRefs"]);
    expect(JSON.parse(renderBodies[0].get("mediaRefs") as string)).toEqual({ a: fpA, b: fpB });
    expect([...renderBodies[1].keys()]).toEqual(["project", "outputs", "mediaRefs", "media_b"]);
    expect(JSON.parse(renderBodies[1].get("mediaRefs") as string)).toEqual({ a: fpA });
  });
});
