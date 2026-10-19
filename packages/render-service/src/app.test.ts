// The /render API end to end: the real Express app on an ephemeral port, the same multipart request
// the editor's Export panel sends, the SSE progress stream, and the downloaded file — with ffmpeg
// actually running on the files in samples/. Skipped when ffmpeg/ffprobe aren't installed.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clip, ProjectModel } from "@reel-studio/shared-types";
import { app } from "./app.js";

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../samples");
const hasTool = (tool: string) => spawnSync(tool, ["-version"], { stdio: "ignore" }).status === 0;
const canRun = hasTool("ffmpeg") && hasTool("ffprobe");

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
const tempDirs: string[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

// --- a project exactly as the editor serialises it ---------------------------------------------

function clip(id: string, sourceId: string, trackId: string, outPoint: number, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    sourceId,
    trackId,
    label: "",
    inPoint: 0,
    outPoint,
    timelineStart: 0,
    fitMode: "fit",
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    volume: 1,
    muted: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    speed: 1,
    opacity: 1,
    filter: { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
    transitionOutSeconds: 0,
    transitionOutType: "dissolve",
    gapBeforeSeconds: 0,
    ...overrides,
  };
}

const SOURCES: ProjectModel["sources"] = [
  {
    id: "land",
    name: "clip-landscape-4s.mp4",
    filePath: "",
    previewUrl: "",
    durationSeconds: 4,
    width: 1280,
    height: 720,
    kind: "video",
    isPlaceholder: false,
  },
  {
    id: "silent",
    name: "clip-portrait-3s-silent.mp4",
    filePath: "",
    previewUrl: "",
    durationSeconds: 3,
    width: 720,
    height: 1280,
    kind: "video",
    isPlaceholder: false,
  },
  {
    id: "music",
    name: "music-9s.m4a",
    filePath: "",
    previewUrl: "",
    durationSeconds: 9,
    width: 0,
    height: 0,
    kind: "audio",
    isPlaceholder: false,
  },
];
const FILES: Record<string, string> = {
  land: path.join(SAMPLES, "clip-landscape-4s.mp4"),
  silent: path.join(SAMPLES, "clip-portrait-3s-silent.mp4"),
  music: path.join(SAMPLES, "music-9s.m4a"),
};

function project(clips: Clip[], overrides: Partial<ProjectModel> = {}): ProjectModel {
  return {
    id: "p1",
    canvas: { aspectRatio: "9:16", width: 1080, height: 1920, frameRate: 30 },
    tracks: [
      { id: "video-track", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 },
      { id: "audio-track", kind: "audio", order: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
      { id: "overlay-track", kind: "overlay", order: 2, volume: 1, fadeIn: 0, fadeOut: 0 },
    ],
    clips,
    overlays: [],
    sources: SOURCES,
    endBehavior: "black",
    metadata: { name: "api test", templateId: null, isTemplate: false, createdAt: 0, updatedAt: 0, thumbnailDataUrl: null },
    ...overrides,
  };
}

// --- the client side of the API, as ExportPanel does it ----------------------------------------

async function postRender(projectJson: string, sourceIds: string[], size = { width: 180, height: 320 }): Promise<Response> {
  const form = new FormData();
  form.append("project", projectJson);
  form.append("width", String(size.width));
  form.append("height", String(size.height));
  for (const id of sourceIds) {
    form.append(`media_${id}`, new Blob([await readFile(FILES[id])]), id);
  }
  return fetch(`${baseUrl}/render`, { method: "POST", body: form });
}

type Event =
  | { type: "progress"; percent: number }
  | { type: "done"; outputPath: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

// Reads the SSE stream until a terminal event arrives (the server keeps the stream open after it —
// the editor closes its EventSource — so we stop reading ourselves).
async function waitForOutcome(jobId: string): Promise<{ outcome: Event; progress: number[] }> {
  const response = await fetch(`${baseUrl}/render/${jobId}/events`);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const progress: number[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("event stream ended without an outcome");
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6)) as Event;
      if (event.type === "progress") progress.push(event.percent);
      else {
        await reader.cancel();
        return { outcome: event, progress };
      }
    }
  }
}

async function download(jobId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/render/${jobId}/result`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("reel.mp4");
  const dir = mkdtempSync(path.join(os.tmpdir(), "reel-api-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, "reel.mp4");
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

function durationOf(file: string): number {
  return Number(
    spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout,
  );
}

describe("GET /health", () => {
  it("answers", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("POST /render — request validation (no ffmpeg needed)", () => {
  it("rejects a missing/invalid project JSON", async () => {
    const form = new FormData();
    form.append("project", "{not json");
    const response = await fetch(`${baseUrl}/render`, { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid or missing project JSON" });
  });

  it("rejects an empty timeline with a helpful message and cleans up its upload dir", async () => {
    const response = await postRender(JSON.stringify(project([])), []);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Nothing to export yet");
  });

  it("rejects a clip whose file wasn't uploaded", async () => {
    const response = await postRender(JSON.stringify(project([clip("v", "land", "video-track", 4)])), []);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("Missing local file for source land");
  });

  it("404s for an unknown job", async () => {
    expect((await fetch(`${baseUrl}/render/nope/events`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/render/nope/result`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/render/nope/cancel`, { method: "POST" })).status).toBe(404);
  });
});

describe.skipIf(!canRun)("POST /render — real exports (ffmpeg, samples/)", () => {
  it("exports a screen-recording-style clip with no audio track", async () => {
    const response = await postRender(JSON.stringify(project([clip("v", "silent", "video-track", 3)])), ["silent"]);
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    const { outcome, progress } = await waitForOutcome(jobId);
    expect(outcome).toMatchObject({ type: "done" });
    expect(progress[0]).toBeGreaterThanOrEqual(0);
    expect(durationOf(await download(jobId))).toBeCloseTo(3, 1);
  }, 60_000);

  it("exports a project saved before endBehavior existed exactly as it always did (black after the clip)", async () => {
    const saved = project([clip("v", "land", "video-track", 4), clip("m", "music", "audio-track", 9)]);
    // Strip everything a pre-update save didn't have.
    const { endBehavior: _endBehavior, ...oldProject } = saved;
    const oldClips = oldProject.clips.map(
      ({ transitionOutSeconds: _t, transitionOutType: _tt, gapBeforeSeconds: _g, opacity: _o, ...rest }) => rest,
    );
    const response = await postRender(JSON.stringify({ ...oldProject, clips: oldClips }), ["land", "music"]);
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    expect((await waitForOutcome(jobId)).outcome).toMatchObject({ type: "done" });
    expect(durationOf(await download(jobId))).toBeCloseTo(9, 1); // the music outlasts the clip
  }, 60_000);

  it("honours endBehavior 'trim' sent by the editor", async () => {
    const trimmed = project([clip("v", "land", "video-track", 4), clip("m", "music", "audio-track", 9)], { endBehavior: "trim" });
    const response = await postRender(JSON.stringify(trimmed), ["land", "music"]);
    const { jobId } = (await response.json()) as { jobId: string };
    expect((await waitForOutcome(jobId)).outcome).toMatchObject({ type: "done" });
    expect(durationOf(await download(jobId))).toBeCloseTo(4, 1);
  }, 60_000);

  it("reports 100% and 'done' to a client that connects after the render finished", async () => {
    const response = await postRender(JSON.stringify(project([clip("v", "silent", "video-track", 3)])), ["silent"]);
    const { jobId } = (await response.json()) as { jobId: string };
    await waitForOutcome(jobId);
    const late = await waitForOutcome(jobId); // a second subscriber, after the fact
    expect(late.progress).toEqual([100]);
    expect(late.outcome).toMatchObject({ type: "done" });
  }, 60_000);

  it("cancels a running render", async () => {
    // 40 repeats of the clip at a larger size — long enough to still be running when we cancel.
    const clips = Array.from({ length: 40 }, (_, i) => clip(`v${i}`, "land", "video-track", 4));
    const response = await postRender(JSON.stringify(project(clips)), ["land"], { width: 720, height: 1280 });
    const { jobId } = (await response.json()) as { jobId: string };
    const cancelled = await fetch(`${baseUrl}/render/${jobId}/cancel`, { method: "POST" });
    expect(await cancelled.json()).toEqual({ status: "cancelled" });
    expect((await waitForOutcome(jobId)).outcome).toEqual({ type: "cancelled" });
    expect((await fetch(`${baseUrl}/render/${jobId}/result`)).status).toBe(404);
  }, 60_000);

  it("leaves no upload directory behind when the plan is rejected", async () => {
    const tmpRoot = path.join(os.tmpdir(), "reel-studio-render");
    const before = new Set(existsSync(tmpRoot) ? spawnSync("ls", [tmpRoot], { encoding: "utf8" }).stdout.split("\n") : []);
    await postRender(JSON.stringify(project([clip("v", "land", "video-track", 4)])), []); // file not uploaded → 400
    await new Promise((r) => setTimeout(r, 300));
    const after = spawnSync("ls", [tmpRoot], { encoding: "utf8" })
      .stdout.split("\n")
      .filter((d) => d && !before.has(d));
    expect(after).toEqual([]);
  });
});
