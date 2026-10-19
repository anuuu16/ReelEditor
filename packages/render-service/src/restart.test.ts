// The service as a real process: an export that was running when the process dies (SIGKILL, so
// nothing gets a chance to tidy up) is still there — and finishes — when the next process starts
// from the same exports folder. Skipped when ffmpeg isn't installed.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectModel } from "@reel-studio/shared-types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(HERE, "../../../samples");
// tsx's loader, hooked straight into one node process (`node --import tsx …`) rather than through
// the `tsx` CLI, which is a wrapper around a child process: SIGKILLing the wrapper would leave the
// real service alive and the "restart" below would restart nothing.
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
const canRun = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

let exportsRoot = "";
let port = 0;
let child: ChildProcess | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startService(): Promise<void> {
  const proc = spawn(process.execPath, ["--import", TSX_LOADER, path.join(HERE, "index.ts")], {
    env: { ...process.env, PORT: String(port), REEL_EXPORTS_ROOT: exportsRoot, RENDER_CONCURRENCY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    // An exit before it's healthy (e.g. EADDRINUSE because the last process is somehow still
    // alive) must fail loudly rather than let the test pass against the wrong process.
    if (proc.exitCode !== null) throw new Error(`service exited with code ${proc.exitCode}:\n${stderr}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`service didn't start:\n${stderr}`);
}

async function killService(): Promise<void> {
  if (!child || child.exitCode !== null) return;
  const proc = child;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGKILL");
  });
  // Really gone: nothing answers on the port any more.
  await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
}

beforeAll(async () => {
  if (!canRun) return;
  exportsRoot = mkdtempSync(path.join(os.tmpdir(), "reel-restart-test-"));
  port = await freePort();
  await startService();
}, 40_000);
afterAll(async () => {
  await killService();
  // ffmpeg children of a SIGKILLed service are orphans; nothing of ours is left to wait for.
  if (exportsRoot) rmSync(exportsRoot, { recursive: true, force: true });
});

function longProject(): ProjectModel {
  const clip = (id: string, timelineStart: number) => ({
    id,
    sourceId: "long",
    trackId: "video-track",
    label: "",
    inPoint: 0,
    outPoint: 30,
    timelineStart,
    fitMode: "fit" as const,
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    volume: 1,
    muted: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    speed: 1,
    opacity: 1,
    filter: { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
    transitionOutSeconds: 1,
    transitionOutType: "dissolve" as const,
    gapBeforeSeconds: 0,
  });
  return {
    id: "restart-project",
    canvas: { aspectRatio: "9:16", width: 1080, height: 1920, frameRate: 30 },
    tracks: [{ id: "video-track", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }],
    clips: [clip("a", 0)],
    overlays: [],
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
    endBehavior: "black",
    metadata: { name: "Survives restarts", templateId: null, isTemplate: false, createdAt: 0, updatedAt: 0, thumbnailDataUrl: null },
  };
}

interface Summary {
  id: string;
  status: string;
  percent: number;
  startedAt: number | null;
  downloadName: string;
  warning: string | null;
}

async function summary(jobId: string): Promise<Summary> {
  return (await fetch(`http://127.0.0.1:${port}/render/${jobId}`)).json() as Promise<Summary>;
}

async function waitFor(jobId: string, predicate: (s: Summary) => boolean, timeoutMs: number): Promise<Summary> {
  const started = Date.now();
  for (;;) {
    const s = await summary(jobId);
    if (predicate(s)) return s;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting on ${jobId}: ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe.skipIf(!canRun)("exports survive a service restart", () => {
  it("three formats, killed while the second renders: #1 stays done, #2 starts over, #3 follows, all download", async () => {
    const form = new FormData();
    form.append("project", JSON.stringify(longProject()));
    form.append("media_long", new Blob([await readFile(path.join(SAMPLES, "clip-long-30s.mp4"))]), "long");
    form.append(
      "outputs",
      JSON.stringify([
        { width: 180, height: 320, format: "gif" }, // #1 quick: done before the kill
        { width: 540, height: 960, format: "mp4" }, // #2 slow: rendering when the kill lands
        { width: 180, height: 320, format: "webm" }, // #3 queued behind it
      ]),
    );
    const response = await fetch(`http://127.0.0.1:${port}/render`, { method: "POST", body: form });
    expect(response.status).toBe(202);
    const { jobIds, batchId } = (await response.json()) as { jobIds: string[]; batchId: string };
    const [gif, mp4, webm] = jobIds;

    await waitFor(gif, (s) => s.status === "done", 60_000);
    const mp4Before = await waitFor(mp4, (s) => s.status === "running" && s.percent > 0 && s.percent < 60, 60_000);
    expect(mp4Before.startedAt).not.toBeNull();
    expect((await summary(webm)).status).toBe("queued");

    // Two more things a crash can leave behind: an upload that was in flight (a batch folder with
    // media but no job yet), and a job.json that was being rewritten (only its temp file exists).
    const abandoned = randomUUID();
    mkdirSync(path.join(exportsRoot, abandoned, "media"), { recursive: true });
    writeFileSync(path.join(exportsRoot, abandoned, "media", "x.mp4"), "partial upload");
    const halfWritten = randomUUID();
    mkdirSync(path.join(exportsRoot, batchId, halfWritten), { recursive: true });
    writeFileSync(path.join(exportsRoot, batchId, halfWritten, "job.json.1.0.tmp"), "{ not finished");

    await killService();
    // The service is gone but its ffmpeg isn't: it's an orphan now, still encoding #2.
    const orphans = () =>
      spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
        .stdout.split("\n")
        .filter((line) => line.includes("ffmpeg") && line.includes(path.basename(exportsRoot)));
    expect(orphans().length).toBeGreaterThanOrEqual(1);
    const restartedAt = Date.now();
    await startService();
    await new Promise((r) => setTimeout(r, 500));
    // …until the next start finds its pid in job.json and stops it, before starting its own.
    expect(orphans().filter((line) => !line.includes("<defunct>"))).toHaveLength(1);

    // Right after the restart: #1 is still done, #2 has started over (by the new process, from the
    // start — not "resumed" at 40%), #3 is still behind it; the leftovers are gone.
    expect((await summary(gif)).status).toBe("done");
    const mp4After = await waitFor(mp4, (s) => s.status === "running" || s.status === "done", 10_000);
    expect(mp4After.startedAt).toBeGreaterThanOrEqual(restartedAt);
    expect(mp4After.startedAt).toBeGreaterThan(mp4Before.startedAt!);
    expect(["queued", "running", "done"]).toContain((await summary(webm)).status);
    if ((await summary(mp4)).status === "running") expect((await summary(webm)).status).toBe("queued");
    expect(existsSync(path.join(exportsRoot, abandoned))).toBe(false);
    expect(existsSync(path.join(exportsRoot, batchId, halfWritten))).toBe(false);

    const listed = (await (await fetch(`http://127.0.0.1:${port}/render?projectId=restart-project`)).json()) as Summary[];
    expect(listed.map((j) => j.id).sort()).toEqual([...jobIds].sort());

    // And it all finishes, in order, with every file complete and of the right kind.
    expect((await waitFor(mp4, (s) => s.status === "done", 180_000)).percent).toBe(100);
    expect((await waitFor(webm, (s) => s.status === "done", 120_000)).status).toBe("done");
    const expected: Array<[string, string, string]> = [
      [gif, "Survives restarts - 180x320.gif", "gif"],
      [mp4, "Survives restarts - 540x960.mp4", "mov,mp4,m4a,3gp,3g2,mj2"],
      [webm, "Survives restarts - 180x320.webm", "matroska,webm"],
    ];
    for (const [id, name, container] of expected) {
      const download = await fetch(`http://127.0.0.1:${port}/render/${id}/result`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-disposition")).toContain(name);
      const file = path.join(exportsRoot, "..", `${name}`);
      writeFileSync(file, Buffer.from(await download.arrayBuffer()));
      const probe = JSON.parse(
        spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=format_name,duration", "-of", "json", file], { encoding: "utf8" })
          .stdout,
      ) as { format: { format_name: string; duration: string } };
      expect(probe.format.format_name).toBe(container);
      expect(Number(probe.format.duration)).toBeCloseTo(30, 0);
      rmSync(file, { force: true });
      expect((await summary(id)).warning).toBeNull();
    }

    // Only the three job folders remain in the batch — the uploads are gone now that all are done.
    await new Promise((r) => setTimeout(r, 300));
    expect(readdirSync(exportsRoot)).toEqual([batchId]);
    expect(readdirSync(path.join(exportsRoot, batchId)).sort()).toEqual([...jobIds].sort());
  }, 300_000);
});
