// The /render API end to end: the real Express app on an ephemeral port, the same multipart request
// the editor's Export panel sends, the SSE progress stream, and the downloaded file — with ffmpeg
// actually running on the files in samples/. Skipped when ffmpeg/ffprobe aren't installed.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clip, ProjectModel } from "@reel-studio/shared-types";
import { app, jobsRestored } from "./app.js";
import { getJob, type JobSummary } from "./jobs.js";
import { batchDir, batchMediaDir, EXPORTS_ROOT, flushJobWrites } from "./jobStore.js";
import { resetRenderQueueForTests } from "./queue.js";

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../samples");
const hasTool = (tool: string) => spawnSync(tool, ["-version"], { stdio: "ignore" }).status === 0;
const canRun = hasTool("ffmpeg") && hasTool("ffprobe");

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
const tempDirs: string[] = [];

beforeAll(async () => {
  await jobsRestored;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await flushJobWrites();
  tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function batchDirs(): string[] {
  return existsSync(EXPORTS_ROOT) ? readdirSync(EXPORTS_ROOT) : [];
}

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

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

interface OutputSpec {
  width: number;
  height: number;
  format?: string;
  label?: string;
}

async function renderForm(projectJson: string, sourceIds: string[]): Promise<FormData> {
  const form = new FormData();
  form.append("project", projectJson);
  for (const id of sourceIds) {
    form.append(`media_${id}`, new Blob([await readFile(FILES[id])]), id);
  }
  return form;
}

// The original single-output request shape (width/height fields), still accepted as-is.
async function postRender(projectJson: string, sourceIds: string[], size = { width: 180, height: 320 }): Promise<Response> {
  const form = await renderForm(projectJson, sourceIds);
  form.append("width", String(size.width));
  form.append("height", String(size.height));
  return fetch(`${baseUrl}/render`, { method: "POST", body: form });
}

// What the Export panel sends now: one upload, a list of outputs.
async function postBatch(projectJson: string, sourceIds: string[], outputs: OutputSpec[] | string): Promise<Response> {
  const form = await renderForm(projectJson, sourceIds);
  form.append("outputs", typeof outputs === "string" ? outputs : JSON.stringify(outputs));
  return fetch(`${baseUrl}/render`, { method: "POST", body: form });
}

async function jobSummary(jobId: string): Promise<JobSummary> {
  const response = await fetch(`${baseUrl}/render/${jobId}`);
  expect(response.status).toBe(200);
  return (await response.json()) as JobSummary;
}

type Event =
  | { type: "queued"; position: number }
  | { type: "reordered"; queueRank: number }
  | { type: "started" }
  | { type: "progress"; percent: number }
  | { type: "done"; outputPath: string; downloadName: string; outputBytes: number | null }
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
      else if (event.type === "queued" || event.type === "reordered" || event.type === "started") continue;
      else {
        await reader.cancel();
        return { outcome: event, progress };
      }
    }
  }
}

async function download(jobId: string, expectedName = "api test - 180x320.mp4"): Promise<string> {
  const response = await fetch(`${baseUrl}/render/${jobId}/result`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain(`filename="${expectedName}"`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "reel-api-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, expectedName);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

function durationOf(file: string): number {
  return Number(
    spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout,
  );
}

function probeOf(file: string): { container: string; codecs: string[] } {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=format_name:stream=codec_name", "-of", "json", file], {
    encoding: "utf8",
  }).stdout;
  const parsed = JSON.parse(out) as { format: { format_name: string }; streams: Array<{ codec_name: string }> };
  return { container: parsed.format.format_name, codecs: parsed.streams.map((s) => s.codec_name) };
}

// Writes the start of a multipart upload and then drops the connection, the way a tab being
// closed mid-export does. Resolves once the socket is gone.
function abortMidUpload(): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/render`);
    const boundary = "----abort-test";
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: "/render",
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      },
      () => {},
    );
    request.on("error", () => {});
    request.on("close", () => resolve());
    request.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="media_land"; filename="land"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    request.write(Buffer.alloc(64 * 1024, 1), () => {
      request.destroy();
    });
  });
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

  it("rejects bad output lists before touching ffmpeg", async () => {
    const json = JSON.stringify(project([clip("v", "silent", "video-track", 3)]));
    const cases: Array<[OutputSpec[] | string, string]> = [
      ["[", "outputs must be a JSON array"],
      ["[]", "at least one output"],
      [[{ width: 180, height: 320, format: "avi" }], 'Unknown output format "avi"'],
      [[{ width: -1, height: 320 }], "positive width and height"],
      [[{ width: 100_000, height: 320 }], "can't exceed"],
      [Array.from({ length: 13 }, () => ({ width: 180, height: 320 })), "At most 12 outputs"],
    ];
    for (const [outputs, message] of cases) {
      const response = await postBatch(json, [], outputs);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain(message);
    }
  });

  it("deletes the uploaded files when the request is rejected, however it's rejected", async () => {
    const before = new Set(batchDirs());
    const form = await renderForm("{not json", ["silent"]); // invalid project JSON, with a file attached
    expect((await fetch(`${baseUrl}/render`, { method: "POST", body: form })).status).toBe(400);
    await postBatch(JSON.stringify(project([clip("v", "silent", "video-track", 3)])), ["silent"], "[]"); // bad outputs
    await postRender(JSON.stringify(project([clip("v", "land", "video-track", 4)])), ["silent"]); // plan can't be built
    await settle();
    expect(batchDirs().filter((d) => !before.has(d))).toEqual([]);
  });

  it("deletes the upload folder when the browser goes away mid-upload", async () => {
    const before = new Set(batchDirs());
    await abortMidUpload();
    await settle(2000); // the first cleanup is immediate; a second pass follows a moment later
    expect(batchDirs().filter((d) => !before.has(d))).toEqual([]);
  });

  it("answers multer's own errors as JSON, not an HTML error page", async () => {
    const response = await fetch(`${baseUrl}/render`, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=nope" },
      body: "this is not multipart at all",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toHaveProperty("error");
  });

  it("404s for an unknown job", async () => {
    expect((await fetch(`${baseUrl}/render/nope`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/render/nope/events`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/render/nope/result`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/render/nope/cancel`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${baseUrl}/render/nope`, { method: "DELETE" })).status).toBe(404);
  });

  it("lists jobs (empty to start with) and streams a snapshot on the all-jobs event stream", async () => {
    const list = await fetch(`${baseUrl}/render?projectId=never-rendered`);
    expect(await list.json()).toEqual([]);
    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/render/events?projectId=never-rendered`, { signal: controller.signal });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"type":"snapshot","jobs":[]');
    controller.abort();
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
    const before = new Set(batchDirs());
    await postRender(JSON.stringify(project([clip("v", "land", "video-track", 4)])), []); // file not uploaded → 400
    await settle(300);
    expect(batchDirs().filter((d) => !before.has(d))).toEqual([]);
  });

  it("names the download after the project, the preset and the size", async () => {
    const named = project([clip("v", "silent", "video-track", 3)], {
      metadata: {
        name: 'Summer: "Beach" day / take 2',
        templateId: null,
        isTemplate: false,
        createdAt: 0,
        updatedAt: 0,
        thumbnailDataUrl: null,
      },
    });
    const response = await postBatch(JSON.stringify(named), ["silent"], [{ width: 180, height: 320, label: "Instagram Reel" }]);
    expect(response.status).toBe(202);
    const { jobs } = (await response.json()) as { jobs: JobSummary[] };
    expect(jobs[0].downloadName).toBe("Summer Beach day take 2 - Instagram Reel 180x320.mp4");
    expect((await waitForOutcome(jobs[0].id)).outcome).toMatchObject({ type: "done", downloadName: jobs[0].downloadName });
    await download(jobs[0].id, jobs[0].downloadName);
  }, 60_000);

  it("exports several formats from one upload, cleans up the upload, and keeps each result until it's deleted", async () => {
    const json = JSON.stringify(project([clip("v", "land", "video-track", 4), clip("m", "music", "audio-track", 6)]));
    const response = await postBatch(
      json,
      ["land", "music"],
      [
        { width: 180, height: 320, format: "mp4" },
        { width: 180, height: 320, format: "webm" },
        { width: 180, height: 320, format: "gif" },
        { width: 180, height: 320, format: "mp4" }, // a duplicate, to see the name get a (2)
      ],
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { batchId: string; jobId: string; jobIds: string[]; jobs: JobSummary[] };
    expect(body.jobIds).toHaveLength(4);
    expect(body.jobId).toBe(body.jobIds[0]);
    expect(body.jobs.map((j) => j.downloadName)).toEqual([
      "api test - 180x320.mp4",
      "api test - 180x320.webm",
      "api test - 180x320.gif",
      "api test - 180x320 (2).mp4",
    ]);
    expect(body.jobs.every((j) => j.batchId === body.batchId)).toBe(true);

    // The batch shows up in the project's list, in the order it was asked for.
    const listed = (await (await fetch(`${baseUrl}/render?projectId=p1`)).json()) as JobSummary[];
    expect(listed.slice(0, 4).map((j) => j.id)).toEqual(body.jobIds);

    for (const jobId of body.jobIds) expect((await waitForOutcome(jobId)).outcome).toMatchObject({ type: "done" });

    const [mp4, webm, gif] = await Promise.all(body.jobs.slice(0, 3).map((j) => download(j.id, j.downloadName)));
    expect(probeOf(mp4)).toEqual({ container: "mov,mp4,m4a,3gp,3g2,mj2", codecs: ["h264", "aac"] });
    expect(probeOf(webm)).toEqual({ container: "matroska,webm", codecs: ["vp9", "opus"] });
    expect(probeOf(gif)).toEqual({ container: "gif", codecs: ["gif"] });
    expect(durationOf(webm)).toBeCloseTo(6, 0);
    const summary = await jobSummary(body.jobIds[0]);
    expect(summary.status).toBe("done");
    expect(summary.outputBytes).toBeGreaterThan(0);

    // The shared uploads are gone now that nothing needs them; the outputs are still there.
    await flushJobWrites();
    await settle();
    expect(existsSync(batchMediaDir(body.batchId))).toBe(false);
    expect(existsSync(batchDir(body.batchId))).toBe(true);

    // Deleting each job removes its files; the last one takes the batch folder with it.
    for (const jobId of body.jobIds) {
      expect((await fetch(`${baseUrl}/render/${jobId}`, { method: "DELETE" })).status).toBe(200);
      expect((await fetch(`${baseUrl}/render/${jobId}/result`)).status).toBe(404);
    }
    await settle(300);
    expect(existsSync(batchDir(body.batchId))).toBe(false);
  }, 120_000);

  it("renders one output at a time, in order; cancelling a queued job drops it, cancelling the running one deletes its half-written file", async () => {
    {
      const clips = Array.from({ length: 40 }, (_, i) => clip(`v${i}`, "land", "video-track", 4));
      const response = await postBatch(
        JSON.stringify(project(clips)),
        ["land"],
        [
          { width: 720, height: 1280 },
          { width: 180, height: 320 },
          { width: 180, height: 320, format: "gif" },
        ],
      );
      const { jobIds } = (await response.json()) as { jobIds: string[] };
      const [first, second, third] = jobIds;
      expect((await jobSummary(first)).status).toBe("running");
      expect(await jobSummary(second)).toMatchObject({ status: "queued", queuePosition: 1 });
      expect(await jobSummary(third)).toMatchObject({ status: "queued", queuePosition: 2 });

      // A queued job's event stream says so, then reports when it starts.
      const waiting = waitForOutcome(third);
      expect(await (await fetch(`${baseUrl}/render/${third}/cancel`, { method: "POST" })).json()).toEqual({ status: "cancelled" });
      expect((await waiting).outcome).toEqual({ type: "cancelled" });
      expect(await jobSummary(second)).toMatchObject({ status: "queued", queuePosition: 1 });

      await fetch(`${baseUrl}/render/${first}/cancel`, { method: "POST" });
      expect((await waitForOutcome(first)).outcome).toEqual({ type: "cancelled" });
      await settle(50);
      expect((await jobSummary(second)).status).toBe("running");
      await fetch(`${baseUrl}/render/${second}/cancel`, { method: "POST" });
      expect((await waitForOutcome(second)).outcome).toEqual({ type: "cancelled" });
      // A cancelled encode leaves no half-written output behind — only its record.
      await settle(200);
      for (const id of [first, second]) {
        expect(readdirSync(getJob(id)!.workDir)).toEqual(["job.json"]);
      }
    }
  }, 60_000);

  it("renders from the saved project's media when the editor refers to it instead of uploading it again", async () => {
    // Save the project with its media first, the way autosave does.
    const saved = project([clip("v", "silent", "video-track", 3)], { id: randomUUID() });
    const saveForm = await renderForm(JSON.stringify(saved), ["silent"]);
    expect((await fetch(`${baseUrl}/projects/${saved.id}`, { method: "POST", body: saveForm })).status).toBe(200);
    const listing = (await (await fetch(`${baseUrl}/projects/${saved.id}/media`)).json()) as Record<string, { fingerprint: string }>;
    expect(Object.keys(listing)).toEqual(["silent"]);

    // Export with no file at all — just the reference.
    const form = new FormData();
    form.append("project", JSON.stringify(saved));
    form.append("outputs", JSON.stringify([{ width: 180, height: 320 }]));
    form.append("mediaRefs", JSON.stringify({ silent: listing.silent.fingerprint }));
    const response = await fetch(`${baseUrl}/render`, { method: "POST", body: form });
    expect(response.status).toBe(202);
    const { jobId, batchId } = (await response.json()) as { jobId: string; batchId: string };
    expect(readdirSync(batchMediaDir(batchId))).toEqual(["silent"]); // its own copy, not a link to the project
    expect((await waitForOutcome(jobId)).outcome).toMatchObject({ type: "done" });
    expect(durationOf(await download(jobId))).toBeCloseTo(3, 1);

    // A reference that doesn't match what's saved (or isn't there) is refused, naming what to upload.
    const stale = new FormData();
    stale.append("project", JSON.stringify(saved));
    stale.append("outputs", JSON.stringify([{ width: 180, height: 320 }]));
    stale.append("mediaRefs", JSON.stringify({ silent: "0".repeat(64), other: listing.silent.fingerprint }));
    const refused = await fetch(`${baseUrl}/render`, { method: "POST", body: stale });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ missingSourceIds: ["silent", "other"] });
    await settle(300);
    expect(batchDirs().filter((d) => d !== batchId).length).toBe(batchDirs().length - 1); // the refused upload left no folder

    // A file that IS uploaded wins over a reference to it, and a malformed mediaRefs is a 400.
    const both = await renderForm(JSON.stringify(saved), ["silent"]);
    both.append("outputs", JSON.stringify([{ width: 180, height: 320 }]));
    both.append("mediaRefs", JSON.stringify({ silent: "not-checked-when-uploaded" }));
    const bothResponse = await fetch(`${baseUrl}/render`, { method: "POST", body: both });
    expect(bothResponse.status).toBe(202);
    expect((await waitForOutcome(((await bothResponse.json()) as { jobId: string }).jobId)).outcome).toMatchObject({ type: "done" });
    const malformed = await renderForm(JSON.stringify(saved), ["silent"]);
    malformed.append("mediaRefs", "[1,2]");
    expect((await fetch(`${baseUrl}/render`, { method: "POST", body: malformed })).status).toBe(400);
  }, 60_000);

  it("reorders the line: a waiting export can be moved to the front, and renders next", async () => {
    const clips = Array.from({ length: 40 }, (_, i) => clip(`v${i}`, "land", "video-track", 4));
    const response = await postBatch(
      JSON.stringify(project(clips)),
      ["land"],
      [
        { width: 720, height: 1280 },
        { width: 180, height: 320, format: "gif" },
        { width: 180, height: 320, format: "mov" },
        { width: 180, height: 320, format: "webm" },
      ],
    );
    const { jobIds } = (await response.json()) as { jobIds: string[] };
    const [running, gif, mov, webm] = jobIds;
    expect((await jobSummary(webm)).queuePosition).toBe(3);

    const moved = await fetch(`${baseUrl}/render/${webm}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "front" }),
    });
    expect(moved.status).toBe(200);
    const body = (await moved.json()) as { job: JobSummary; line: JobSummary[] };
    expect(body.job.queuePosition).toBe(1);
    expect(body.line.map((j) => j.id)).toEqual([webm, gif, mov]);
    expect(await jobSummary(gif)).toMatchObject({ queuePosition: 2 });
    // Persisted: the order would be the same after a restart.
    await flushJobWrites();
    const onDisk = JSON.parse(readFileSync(path.join(getJob(webm)!.workDir, "job.json"), "utf8")) as JobSummary;
    expect(onDisk.queueRank).toBe(body.job.queueRank);
    expect(onDisk.queueRank).toBeLessThan((await jobSummary(gif)).queueRank);

    // Bad requests: an unknown direction, a job that isn't waiting, an unknown job.
    const bad = await fetch(`${baseUrl}/render/${gif}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "sideways" }),
    });
    expect(bad.status).toBe(400);
    const notWaiting = await fetch(`${baseUrl}/render/${running}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "front" }),
    });
    expect(notWaiting.status).toBe(409);
    expect((await fetch(`${baseUrl}/render/nope/move`, { method: "POST" })).status).toBe(404);

    // Cancel the running one: the moved job is what renders next.
    await fetch(`${baseUrl}/render/${running}/cancel`, { method: "POST" });
    await settle(100);
    expect((await jobSummary(webm)).status).toBe("running");
    for (const id of [webm, gif, mov]) await fetch(`${baseUrl}/render/${id}/cancel`, { method: "POST" });
    for (const id of [webm, gif, mov]) expect((await waitForOutcome(id)).outcome).toEqual({ type: "cancelled" });
  }, 60_000);

  it("retries a cancelled or failed export with the same settings, in place of the old record", async () => {
    const clips = Array.from({ length: 40 }, (_, i) => clip(`v${i}`, "land", "video-track", 4));
    const response = await postBatch(JSON.stringify(project(clips)), ["land"], [{ width: 180, height: 320, format: "gif", label: "Loop" }]);
    const { jobId, batchId } = (await response.json()) as { jobId: string; batchId: string };
    // Still running: no retry.
    expect((await fetch(`${baseUrl}/render/${jobId}/retry`, { method: "POST" })).status).toBe(409);
    await fetch(`${baseUrl}/render/${jobId}/cancel`, { method: "POST" });
    expect((await waitForOutcome(jobId)).outcome).toEqual({ type: "cancelled" });
    await flushJobWrites();
    await settle();
    expect(existsSync(batchMediaDir(batchId))).toBe(true); // kept: the cancelled job can be retried

    const retried = await fetch(`${baseUrl}/render/${jobId}/retry`, { method: "POST" });
    expect(retried.status).toBe(202);
    const replacement = (await retried.json()) as JobSummary;
    expect(replacement.id).not.toBe(jobId);
    expect(replacement).toMatchObject({
      batchId,
      status: expect.stringMatching(/queued|running/),
      downloadName: "api test - Loop 180x320.gif",
      output: { width: 180, height: 320, format: "gif", label: "Loop" },
    });
    expect((await fetch(`${baseUrl}/render/${jobId}`)).status).toBe(404); // the old record is gone
    expect((await waitForOutcome(replacement.id)).outcome).toMatchObject({ type: "done" });
    await download(replacement.id, "api test - Loop 180x320.gif");

    // Now that everything in the batch is done, the uploads are gone — and so is any further retry.
    await flushJobWrites();
    await settle();
    expect(existsSync(batchMediaDir(batchId))).toBe(false);
    const again = await fetch(`${baseUrl}/render/${replacement.id}/retry`, { method: "POST" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain("no longer on the service");
    expect((await fetch(`${baseUrl}/render/nope/retry`, { method: "POST" })).status).toBe(404);
  }, 90_000);

  it("with RENDER_CONCURRENCY above one, small exports may run side by side", async () => {
    resetRenderQueueForTests(2);
    try {
      const json = JSON.stringify(project([clip("v", "silent", "video-track", 3)]));
      const response = await postBatch(
        json,
        ["silent"],
        [
          { width: 180, height: 320 },
          { width: 180, height: 320, format: "mov" },
        ],
      );
      const { jobIds } = (await response.json()) as { jobIds: string[] };
      const statuses = await Promise.all(jobIds.map((id) => jobSummary(id).then((j) => j.status)));
      expect(statuses).toEqual(["running", "running"]);
      for (const id of jobIds) expect((await waitForOutcome(id)).outcome).toMatchObject({ type: "done" });
    } finally {
      resetRenderQueueForTests(1);
    }
  }, 60_000);

  it("reports every job's progress on the all-jobs stream, for the project asked about only", async () => {
    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/render/events?projectId=p1`, { signal: controller.signal });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    const seen: Array<{ type: string; job?: JobSummary; jobId?: string }> = [];
    const pump = (async () => {
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.startsWith("data: ")) seen.push(JSON.parse(line.slice(6)));
      }
    })().catch(() => {});

    const other = project([clip("v", "silent", "video-track", 3)], { id: "p-other" });
    const otherResponse = await postBatch(JSON.stringify(other), ["silent"], [{ width: 180, height: 320 }]);
    const otherId = ((await otherResponse.json()) as { jobId: string }).jobId;
    const mine = await postBatch(
      JSON.stringify(project([clip("v", "silent", "video-track", 3)])),
      ["silent"],
      [{ width: 180, height: 320 }],
    );
    const mineId = ((await mine.json()) as { jobId: string }).jobId;
    await waitForOutcome(mineId);
    await waitForOutcome(otherId);
    await fetch(`${baseUrl}/render/${mineId}`, { method: "DELETE" });
    await settle();
    controller.abort();
    await pump;

    expect(seen[0].type).toBe("snapshot");
    const mineEvents = seen.filter((e) => e.type === "job" && e.job?.id === mineId);
    expect(mineEvents.map((e) => (e as { event: { type: string } }).event.type)).toEqual(
      expect.arrayContaining(["started", "progress", "done"]),
    );
    expect(mineEvents[mineEvents.length - 1].job).toMatchObject({ status: "done", percent: 100 });
    expect(seen.some((e) => e.type === "job" && e.job?.id === otherId)).toBe(false);
    expect(seen).toContainEqual({ type: "removed", jobId: mineId });
  }, 60_000);
});

describe.skipIf(!canRun)("POST /render — real-life trouble (ffmpeg, samples/)", () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "reel-broken-"));
  tempDirs.push(scratch);

  function brokenUpload(name: string, bytes: Buffer, projectJson: string, outputs: OutputSpec[] = [{ width: 180, height: 320 }]): FormData {
    const form = new FormData();
    form.append("project", projectJson);
    form.append("outputs", JSON.stringify(outputs));
    form.append(`media_${name}`, new Blob([bytes]), `${name}.mp4`);
    return form;
  }

  it("refuses a video file that isn't one (garbage bytes) before creating any job, naming the clip", async () => {
    const before = new Set(batchDirs());
    const named = project([clip("v", "land", "video-track", 4)], {
      metadata: { name: "holiday", templateId: null, isTemplate: false, createdAt: 0, updatedAt: 0, thumbnailDataUrl: null },
    });
    named.sources = named.sources.map((s) => (s.id === "land" ? { ...s, name: "holiday-4k.mp4" } : s));
    const form = brokenUpload("land", Buffer.alloc(200_000, 0x5a), JSON.stringify(named), [
      { width: 180, height: 320 },
      { width: 180, height: 320, format: "gif" },
    ]);
    const response = await fetch(`${baseUrl}/render`, { method: "POST", body: form });
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain('"holiday-4k.mp4" can\'t be read as media');
    expect(error).toContain("Re-import it");
    expect(((await (await fetch(`${baseUrl}/render?projectId=p1`)).json()) as JobSummary[]).some((j) => j.projectName === "holiday")).toBe(
      false,
    );
    await settle(300);
    expect(batchDirs().filter((d) => !before.has(d))).toEqual([]); // the upload is gone too
  }, 30_000);

  it("refuses an mp4 cut off before its index (the common 'download stopped half-way' file)", async () => {
    const whole = await readFile(path.join(SAMPLES, "clip-long-30s.mp4"));
    const form = brokenUpload("land", whole.subarray(0, whole.length >> 1), JSON.stringify(project([clip("v", "land", "video-track", 4)])));
    const response = await fetch(`${baseUrl}/render`, { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("can't be read as media");
  }, 30_000);

  it("refuses an empty image used as a clip", async () => {
    const withImage = project([clip("v", "pic", "video-track", 2)], {
      sources: [
        ...SOURCES,
        {
          id: "pic",
          name: "empty.png",
          filePath: "",
          previewUrl: "",
          durationSeconds: 2,
          width: 16,
          height: 16,
          kind: "image",
          isPlaceholder: false,
        },
      ],
    });
    const form = new FormData();
    form.append("project", JSON.stringify(withImage));
    form.append("outputs", JSON.stringify([{ width: 180, height: 320 }]));
    form.append("media_pic", new Blob([]), "empty.png");
    const response = await fetch(`${baseUrl}/render`, { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('"empty.png" can\'t be read');
  }, 30_000);

  it("finishes a clip whose file ends early (index intact, data cut off) but warns that the result is short", async () => {
    // A faststart mp4 keeps its index at the front, so half of it still opens fine — and plays 15 s.
    const faststart = path.join(scratch, "faststart.mp4");
    spawnSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      path.join(SAMPLES, "clip-long-30s.mp4"),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      faststart,
    ]);
    const whole = await readFile(faststart);
    const longProject = project([clip("v", "long", "video-track", 30)], {
      sources: [
        {
          id: "long",
          name: "clip-long-30s.mp4",
          filePath: "",
          previewUrl: "",
          durationSeconds: 30,
          width: 1280,
          height: 720,
          kind: "video",
          isPlaceholder: false,
        },
      ],
    });
    const form = brokenUpload("long", whole.subarray(0, whole.length >> 1), JSON.stringify(longProject));
    const response = await fetch(`${baseUrl}/render`, { method: "POST", body: form });
    expect(response.status).toBe(202); // it opens, so there's no way to know yet
    const { jobId } = (await response.json()) as { jobId: string };
    const { outcome } = await waitForOutcome(jobId);
    // ffmpeg exits 0 (the plan pads the clip out with its last frame and silence), but says on the
    // way that the file was cut short — and that's relayed, naming the file.
    expect(outcome).toMatchObject({ type: "done", warning: expect.stringContaining('unreadable data in "clip-long-30s.mp4"') });
    const summary = await jobSummary(jobId);
    expect(summary.warning).toContain("frozen frame and silence");
    expect(summary.warning).toMatch(/partial file|Invalid NAL unit|Invalid data found/); // ffmpeg's own words, for the curious
    expect(durationOf(await download(jobId))).toBeCloseTo(30, 0); // full length — the tail is the frozen frame
  }, 90_000);

  it("a healthy export carries no warning", async () => {
    const response = await postBatch(
      JSON.stringify(project([clip("v", "silent", "video-track", 3)])),
      ["silent"],
      [{ width: 180, height: 320 }],
    );
    const { jobId } = (await response.json()) as { jobId: string };
    expect((await waitForOutcome(jobId)).outcome).toMatchObject({ type: "done", warning: null });
  }, 60_000);

  it("refuses a media field name that would escape the upload folder", async () => {
    const form = new FormData();
    form.append("project", JSON.stringify(project([clip("v", "silent", "video-track", 3)])));
    form.append("outputs", JSON.stringify([{ width: 180, height: 320 }]));
    form.append("media_../../escaped", new Blob([await readFile(FILES.silent)]), "escaped.mp4");
    const response = await fetch(`${baseUrl}/render`, { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("Invalid media field name");
    expect(existsSync(path.join(EXPORTS_ROOT, "escaped.mp4"))).toBe(false);
    expect(existsSync(path.join(EXPORTS_ROOT, "..", "escaped.mp4"))).toBe(false);
    // The same guard on project saves.
    const save = new FormData();
    save.append("project", JSON.stringify(project([])));
    save.append("media_..%2F..%2Fx", new Blob(["x"]), "x.mp4");
    expect((await fetch(`${baseUrl}/projects/${randomUUID()}`, { method: "POST", body: save })).status).toBe(400);
  });
});

describe.skipIf(!canRun)("POST /render — edge cases (ffmpeg, samples/)", () => {
  it("an output with no size means the project canvas; odd sizes are rounded to even; labels are capped", async () => {
    const json = JSON.stringify(project([clip("v", "silent", "video-track", 3)]));
    const response = await postBatch(json, ["silent"], [{} as OutputSpec, { width: 181, height: 319, label: "x".repeat(100) }]);
    expect(response.status).toBe(202);
    const { jobs, jobIds } = (await response.json()) as { jobs: JobSummary[]; jobIds: string[] };
    expect(jobs[0].output).toMatchObject({ width: 1080, height: 1920, format: "mp4", label: null });
    expect(jobs[1].output).toMatchObject({ width: 182, height: 320 });
    expect(jobs[1].output.label).toHaveLength(60);
    for (const id of jobIds) await fetch(`${baseUrl}/render/${id}/cancel`, { method: "POST" });
    for (const id of jobIds) expect((await waitForOutcome(id)).outcome).toEqual({ type: "cancelled" });
  }, 30_000);

  it("cancelling a finished job changes nothing; deleting a running one stops it and removes its folder", async () => {
    const json = JSON.stringify(project([clip("v", "silent", "video-track", 3)]));
    const done = ((await (await postBatch(json, ["silent"], [{ width: 180, height: 320 }])).json()) as { jobId: string }).jobId;
    expect((await waitForOutcome(done)).outcome).toMatchObject({ type: "done" });
    expect(await (await fetch(`${baseUrl}/render/${done}/cancel`, { method: "POST" })).json()).toEqual({ status: "done" });
    expect((await fetch(`${baseUrl}/render/${done}/result`)).status).toBe(200); // still downloadable

    const clips = Array.from({ length: 40 }, (_, i) => clip(`v${i}`, "land", "video-track", 4));
    const running = (
      (await (await postBatch(JSON.stringify(project(clips)), ["land"], [{ width: 720, height: 1280 }])).json()) as { jobId: string }
    ).jobId;
    await settle(300);
    const job = getJob(running)!;
    expect(job.status).toBe("running");
    const workDir = job.workDir;
    expect((await fetch(`${baseUrl}/render/${running}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${baseUrl}/render/${running}`)).status).toBe(404);
    await expect.poll(() => existsSync(workDir), { timeout: 5_000 }).toBe(false);
    await fetch(`${baseUrl}/render/${done}`, { method: "DELETE" });
  }, 60_000);

  it("a retried export can itself be cancelled and retried again", async () => {
    const clips = Array.from({ length: 40 }, (_, i) => clip(`v${i}`, "land", "video-track", 4));
    const first = (
      (await (await postBatch(JSON.stringify(project(clips)), ["land"], [{ width: 720, height: 1280 }])).json()) as { jobId: string }
    ).jobId;
    await fetch(`${baseUrl}/render/${first}/cancel`, { method: "POST" });
    await waitForOutcome(first);
    const second = ((await (await fetch(`${baseUrl}/render/${first}/retry`, { method: "POST" })).json()) as JobSummary).id;
    await settle(200);
    await fetch(`${baseUrl}/render/${second}/cancel`, { method: "POST" });
    expect((await waitForOutcome(second)).outcome).toEqual({ type: "cancelled" });
    const third = await fetch(`${baseUrl}/render/${second}/retry`, { method: "POST" });
    expect(third.status).toBe(202);
    const thirdId = ((await third.json()) as JobSummary).id;
    await fetch(`${baseUrl}/render/${thirdId}/cancel`, { method: "POST" });
    expect((await waitForOutcome(thirdId)).outcome).toEqual({ type: "cancelled" });
    expect(
      (await (await fetch(`${baseUrl}/render?projectId=p1`)).json()).filter((j: JobSummary) => [first, second].includes(j.id)),
    ).toEqual([]);
  }, 60_000);
});
