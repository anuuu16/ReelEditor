import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearJobsForTests,
  completeJob,
  createJob,
  failJob,
  getJob,
  listJobs,
  removeJob,
  startJob,
  type Job,
  type JobInit,
} from "./jobs.js";
import {
  batchDir,
  batchMediaDir,
  batchNeedsMedia,
  EXPORTS_ROOT,
  flushJobWrites,
  installJobPersistence,
  jobDir,
  loadPersistedJobs,
  removeBatchMediaIfIdle,
  sweepOrphanDirs,
  writeJobFile,
} from "./jobStore.js";

function makeJob(batchId: string, id = randomUUID(), overrides: Partial<JobInit> = {}): Job {
  return createJob({
    id,
    batchId,
    projectId: "project-1",
    projectName: "Persisted",
    output: { width: 540, height: 960, format: "mp4", label: "Instagram Reel" },
    downloadName: "Persisted - Instagram Reel 540x960.mp4",
    workDir: jobDir(batchId, id),
    totalDurationSeconds: 12,
    plan: {
      args: ["-y", "-i", "in.mp4", "output.mp4"],
      outputFileName: "output.mp4",
      overlayTextFiles: [{ fileName: "t.txt", content: "Hi" }],
    },
    cost: 2,
    ...overrides,
  });
}

beforeEach(() => {
  installJobPersistence();
  clearJobsForTests();
});
afterEach(async () => {
  await flushJobWrites();
  clearJobsForTests();
});

describe("jobStore", () => {
  it("uses a per-run folder under the temp dir in tests (never the real projects folder)", () => {
    expect(EXPORTS_ROOT).toContain("reel-studio-test-exports-");
  });

  it("writes job.json on every status change and reads it back after a 'restart'", async () => {
    const batchId = randomUUID();
    const job = makeJob(batchId);
    await writeJobFile(job);
    const file = path.join(job.workDir, "job.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ id: job.id, status: "queued", batchId });

    startJob(job);
    await flushJobWrites();
    expect(JSON.parse(readFileSync(file, "utf8")).status).toBe("running");

    writeFileSync(path.join(job.workDir, "output.mp4"), "fake-bytes");
    completeJob(job, path.join(job.workDir, "output.mp4"), 10);
    await flushJobWrites();
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk).toMatchObject({ status: "done", percent: 100, outputFileName: "output.mp4", outputBytes: 10 });
    expect(onDisk.plan.args).toEqual(["-y", "-i", "in.mp4", "output.mp4"]);
    expect(onDisk).not.toHaveProperty("process");

    clearJobsForTests();
    const toResume = await loadPersistedJobs();
    expect(toResume).toEqual([]);
    const restored = getJob(job.id)!;
    expect(restored).toMatchObject({
      status: "done",
      percent: 100,
      outputBytes: 10,
      downloadName: "Persisted - Instagram Reel 540x960.mp4",
      cost: 2,
      batchId,
    });
    expect(restored.outputPath).toBe(path.join(job.workDir, "output.mp4"));
    expect(restored.queueRank).toBe(job.queueRank);
    expect(restored.plan.overlayTextFiles).toEqual([{ fileName: "t.txt", content: "Hi" }]);
  });

  it("brings jobs that were queued or running back as queued, oldest first and a batch in its own order", async () => {
    const batchId = randomUUID();
    const running = makeJob(batchId, undefined, { createdAt: 1000, batchIndex: 0 });
    startJob(running);
    running.percent = 57;
    const queued = makeJob(batchId, undefined, { createdAt: 1000, batchIndex: 1 }); // same batch, same moment
    const earlier = makeJob(randomUUID(), undefined, { createdAt: 500 });
    startJob(earlier);
    await Promise.all([queued, running, earlier].map(writeJobFile));

    clearJobsForTests();
    const toResume = await loadPersistedJobs();
    expect(toResume.map((j) => j.id)).toEqual([earlier.id, running.id, queued.id]);
    for (const job of toResume) {
      expect(job.status).toBe("queued");
      expect(job.percent).toBe(0);
      expect(job.startedAt).toBeNull();
    }
  });

  it("marks a finished job whose file has gone as failed instead of offering a dead download", async () => {
    const batchId = randomUUID();
    const job = makeJob(batchId);
    startJob(job);
    completeJob(job, path.join(job.workDir, "output.mp4")); // never actually written
    await flushJobWrites();
    clearJobsForTests();
    await loadPersistedJobs();
    const restored = getJob(job.id)!;
    expect(restored.status).toBe("error");
    expect(restored.errorMessage).toContain("no longer on disk");
    expect(restored.outputPath).toBeNull();
  });

  it("keeps failed and cancelled jobs so the editor can still show what happened", async () => {
    const batchId = randomUUID();
    const job = makeJob(batchId);
    startJob(job);
    failJob(job, "ffmpeg exited with code 1");
    await flushJobWrites();
    clearJobsForTests();
    await loadPersistedJobs();
    expect(getJob(job.id)).toMatchObject({ status: "error", errorMessage: "ffmpeg exited with code 1" });
  });

  it("ignores folders that aren't batches, and job folders whose job.json is unreadable", async () => {
    mkdirSync(path.join(EXPORTS_ROOT, "not-a-batch", "x"), { recursive: true });
    const batchId = randomUUID();
    mkdirSync(jobDir(batchId, "broken"), { recursive: true });
    writeFileSync(path.join(jobDir(batchId, "broken"), "job.json"), "{not json");
    mkdirSync(batchMediaDir(batchId), { recursive: true });
    const toResume = await loadPersistedJobs();
    expect(toResume.some((job) => job.batchId === batchId)).toBe(false);
    expect(listJobs({ batchId })).toEqual([]);
    expect(getJob("broken")).toBeUndefined();
  });

  it("keeps the shared uploads while anything in the batch still renders or could be retried", async () => {
    const batchId = randomUUID();
    mkdirSync(batchMediaDir(batchId), { recursive: true });
    writeFileSync(path.join(batchMediaDir(batchId), "src.mp4"), "x");
    const a = makeJob(batchId);
    const b = makeJob(batchId);
    startJob(a);
    startJob(b);
    completeJob(a, path.join(a.workDir, "output.mp4"));
    await flushJobWrites();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(batchMediaDir(batchId))).toBe(true); // b is still running
    failJob(b, "nope");
    await flushJobWrites();
    await new Promise((r) => setTimeout(r, 50));
    expect(batchNeedsMedia(batchId)).toBe(true);
    expect(existsSync(batchMediaDir(batchId))).toBe(true); // b failed: a retry would need them
    removeJob(b);
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(batchMediaDir(batchId))).toBe(false); // nothing left that could use them
    expect(existsSync(a.workDir)).toBe(true); // the finished output is still there to download
  });

  it("deletes the shared uploads as soon as every job in the batch has finished well", async () => {
    const batchId = randomUUID();
    mkdirSync(batchMediaDir(batchId), { recursive: true });
    const a = makeJob(batchId);
    startJob(a);
    completeJob(a, path.join(a.workDir, "output.mp4"));
    await flushJobWrites();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(batchMediaDir(batchId))).toBe(false);
  });

  it("removes a job's folder when it's removed, and the batch folder with the last job", async () => {
    const batchId = randomUUID();
    const a = makeJob(batchId);
    const b = makeJob(batchId);
    await Promise.all([writeJobFile(a), writeJobFile(b)]);
    removeJob(a);
    await flushJobWrites();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(a.workDir)).toBe(false);
    expect(existsSync(batchDir(batchId))).toBe(true);
    removeJob(b);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(batchDir(batchId))).toBe(false);
  });

  it("sweeps abandoned upload folders and strays inside live batches, but only old ones", async () => {
    const abandoned = randomUUID();
    mkdirSync(batchMediaDir(abandoned), { recursive: true });
    const fresh = randomUUID();
    mkdirSync(batchMediaDir(fresh), { recursive: true });
    const live = randomUUID();
    const job = makeJob(live);
    await writeJobFile(job);
    mkdirSync(path.join(batchDir(live), "stray"), { recursive: true });
    mkdirSync(batchMediaDir(live), { recursive: true });

    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(batchDir(abandoned), old, old);
    utimesSync(batchDir(live), old, old);

    const removed = await sweepOrphanDirs(60 * 60 * 1000);
    expect(removed.sort()).toEqual([batchDir(abandoned), path.join(batchDir(live), "stray")].sort());
    expect(existsSync(batchDir(fresh))).toBe(true);
    expect(existsSync(job.workDir)).toBe(true);
    expect(existsSync(batchMediaDir(live))).toBe(true); // the job is still queued, it needs its media

    startJob(job);
    failJob(job, "x");
    await flushJobWrites();
    await removeBatchMediaIfIdle(live);
    expect(existsSync(batchMediaDir(live))).toBe(true); // failed: kept for a retry
    removeJob(job);
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(batchMediaDir(live))).toBe(false);
  });

  it("after a crash between the last job finishing and the cleanup, the restart deletes the batch's uploads", async () => {
    const batchId = randomUUID();
    mkdirSync(batchMediaDir(batchId), { recursive: true });
    writeFileSync(path.join(batchMediaDir(batchId), "src.mp4"), "x");
    const job = makeJob(batchId);
    startJob(job);
    mkdirSync(job.workDir, { recursive: true });
    writeFileSync(path.join(job.workDir, "output.mp4"), "bytes");
    completeJob(job, path.join(job.workDir, "output.mp4"), 5, "the tail is a frozen frame");
    await flushJobWrites();
    // (Pretend the media cleanup never ran: put the folder back.)
    mkdirSync(batchMediaDir(batchId), { recursive: true });
    clearJobsForTests();
    await loadPersistedJobs();
    expect(getJob(job.id)?.warning).toBe("the tail is a frozen frame"); // the warning survives too
    await removeBatchMediaIfIdle(batchId); // what app.ts does for every batch on start
    expect(existsSync(batchMediaDir(batchId))).toBe(false);
    expect(existsSync(path.join(job.workDir, "output.mp4"))).toBe(true);
  });

  it("a job folder holding only a half-written manifest is not a job, and the batch is swept if that's all it had", async () => {
    const batchId = randomUUID();
    const jobId = randomUUID();
    mkdirSync(jobDir(batchId, jobId), { recursive: true });
    writeFileSync(path.join(jobDir(batchId, jobId), "job.json.123.0.tmp"), '{ "id": ');
    await loadPersistedJobs();
    expect(getJob(jobId)).toBeUndefined();
    expect(await sweepOrphanDirs(0)).toContain(batchDir(batchId));
    expect(existsSync(batchDir(batchId))).toBe(false);
  });
});
