import { afterEach, describe, expect, it } from "vitest";
import {
  cancelJob,
  clearJobsForTests,
  completeJob,
  createJob,
  failJob,
  getJob,
  jobEvents,
  listJobs,
  removeJob,
  startJob,
  sweepOldJobs,
  toJobSummary,
  updateJobProgress,
  type Job,
  type JobEvent,
  type JobInit,
} from "./jobs.js";

function init(id: string, overrides: Partial<JobInit> = {}): JobInit {
  return {
    id,
    batchId: "batch-1",
    projectId: "project-1",
    projectName: "Test",
    output: { width: 1080, height: 1920, format: "mp4", label: null },
    downloadName: "Test - 1080x1920.mp4",
    workDir: `/tmp/${id}`,
    totalDurationSeconds: 10,
    plan: { args: ["-y"], outputFileName: "output.mp4", overlayTextFiles: [] },
    ...overrides,
  };
}

function record(jobId: string): JobEvent[] {
  const events: JobEvent[] = [];
  getJob(jobId)!.emitter.on("update", (e: JobEvent) => events.push(e));
  return events;
}

afterEach(() => clearJobsForTests());

describe("jobs", () => {
  it("runs: queued → started → progress → done", () => {
    const job = createJob(init("j-done"));
    expect(job.status).toBe("queued");
    const events = record(job.id);
    startJob(job);
    updateJobProgress(job, 40);
    completeJob(job, "/tmp/j-done/output.mp4", 1234);
    expect(job.status).toBe("done");
    expect(job.percent).toBe(100);
    expect(job.outputBytes).toBe(1234);
    expect(job.finishedAt).not.toBeNull();
    expect(events).toEqual([
      { type: "started" },
      { type: "progress", percent: 40 },
      { type: "done", outputPath: "/tmp/j-done/output.mp4", downloadName: "Test - 1080x1920.mp4", outputBytes: 1234, warning: null },
    ]);
  });

  it("ignores progress and completion before it has started", () => {
    const job = createJob(init("j-queued"));
    const events = record(job.id);
    updateJobProgress(job, 50);
    completeJob(job, "/tmp/nope");
    expect(job.status).toBe("queued");
    expect(events).toEqual([]);
  });

  it("fails once and then ignores every later update", () => {
    const job = createJob(init("j-fail"));
    startJob(job);
    const events = record(job.id);
    failJob(job, "ffmpeg exited with code 1");
    updateJobProgress(job, 99);
    completeJob(job, "/tmp/nope");
    expect(job.status).toBe("error");
    expect(job.errorMessage).toBe("ffmpeg exited with code 1");
    expect(events).toEqual([{ type: "error", message: "ffmpeg exited with code 1" }]);
  });

  it("can fail while still queued (e.g. the service couldn't prepare it)", () => {
    const job = createJob(init("j-fail-queued"));
    failJob(job, "no disk");
    expect(job.status).toBe("error");
  });

  it("cancels a running job and kills its process", () => {
    const job = createJob(init("j-cancel"));
    startJob(job);
    const events = record(job.id);
    let killedWith: string | undefined;
    job.process = { kill: (signal: string) => void (killedWith = signal) } as never;
    cancelJob(job);
    expect(job.status).toBe("cancelled");
    expect(killedWith).toBe("SIGKILL");
    expect(job.process).toBeNull();
    expect(events).toEqual([{ type: "cancelled" }]);
    cancelJob(job); // a second cancel is a no-op
    expect(events).toHaveLength(1);
  });

  it("cancels a job that never left the queue", () => {
    const job = createJob(init("j-cancel-queued"));
    const events = record(job.id);
    cancelJob(job);
    expect(job.status).toBe("cancelled");
    expect(events).toEqual([{ type: "cancelled" }]);
    startJob(job); // too late to start
    expect(job.status).toBe("cancelled");
  });

  it("mirrors every per-job event on the shared jobEvents emitter", () => {
    const seen: Array<[string, string]> = [];
    const listener = (job: Job, event: JobEvent) => seen.push([job.id, event.type]);
    jobEvents.on("update", listener);
    const job = createJob(init("j-shared"));
    startJob(job);
    completeJob(job, "/tmp/out.mp4");
    jobEvents.off("update", listener);
    expect(seen).toEqual([
      ["j-shared", "started"],
      ["j-shared", "done"],
    ]);
  });

  it("lists newest batch first, and a batch in the order it was created", () => {
    const t = Date.now();
    createJob(init("old-a", { batchId: "old", createdAt: t - 1000 }));
    createJob(init("old-b", { batchId: "old", createdAt: t - 1000 }));
    createJob(init("new-a", { batchId: "new", projectId: "project-2", createdAt: t }));
    expect(listJobs().map((j) => j.id)).toEqual(["new-a", "old-a", "old-b"]);
    expect(listJobs({ projectId: "project-2" }).map((j) => j.id)).toEqual(["new-a"]);
    expect(listJobs({ batchId: "old" }).map((j) => j.id)).toEqual(["old-a", "old-b"]);
  });

  it("removes a job (cancelling it first) and announces the removal", () => {
    const job = createJob(init("j-remove"));
    startJob(job);
    const removed: string[] = [];
    const listener = (j: Job) => removed.push(j.id);
    jobEvents.on("removed", listener);
    removeJob(job);
    jobEvents.off("removed", listener);
    expect(job.status).toBe("cancelled");
    expect(getJob("j-remove")).toBeUndefined();
    expect(removed).toEqual(["j-remove"]);
  });

  it("summarises without any of the runtime fields", () => {
    const job = createJob(init("j-summary"));
    const summary = toJobSummary(job);
    expect(summary).not.toHaveProperty("process");
    expect(summary).not.toHaveProperty("plan");
    expect(summary).not.toHaveProperty("workDir");
    expect(summary).toMatchObject({ id: "j-summary", status: "queued", downloadName: "Test - 1080x1920.mp4" });
  });

  it("sweeps finished jobs older than the limit, never active ones", () => {
    const old = createJob(init("j-old"));
    startJob(old);
    completeJob(old, "/tmp/j-old/output.mp4");
    old.finishedAt = Date.now() - 10_000;
    const running = createJob(init("j-running"));
    startJob(running);
    running.startedAt = Date.now() - 10_000;
    createJob(init("j-waiting", { createdAt: Date.now() - 10_000 }));
    const fresh = createJob(init("j-fresh"));
    startJob(fresh);
    completeJob(fresh, "/tmp/j-fresh/output.mp4");

    const deleted: string[] = [];
    sweepOldJobs(5_000, (job) => deleted.push(job.id));
    expect(deleted).toEqual(["j-old"]);
    expect(getJob("j-old")).toBeUndefined();
    expect(getJob("j-running")?.status).toBe("running");
    expect(getJob("j-waiting")?.status).toBe("queued");
    expect(getJob("j-fresh")?.status).toBe("done");
  });
});
