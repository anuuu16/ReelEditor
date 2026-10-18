import { describe, expect, it } from "vitest";
import { cancelJob, completeJob, createJob, failJob, getJob, sweepOldJobs, updateJobProgress, type JobEvent } from "./jobs.js";

function record(jobId: string): JobEvent[] {
  const events: JobEvent[] = [];
  getJob(jobId)!.emitter.on("update", (e: JobEvent) => events.push(e));
  return events;
}

describe("jobs", () => {
  it("runs: progress → done", () => {
    const job = createJob("j-done", "/tmp/j-done", 10);
    const events = record(job.id);
    updateJobProgress(job, 40);
    completeJob(job, "/tmp/j-done/output.mp4");
    expect(job.status).toBe("done");
    expect(job.percent).toBe(100);
    expect(events).toEqual([
      { type: "progress", percent: 40 },
      { type: "done", outputPath: "/tmp/j-done/output.mp4" },
    ]);
  });

  it("fails once and then ignores every later update", () => {
    const job = createJob("j-fail", "/tmp/j-fail", 10);
    const events = record(job.id);
    failJob(job, "ffmpeg exited with code 1");
    updateJobProgress(job, 99);
    completeJob(job, "/tmp/nope");
    expect(job.status).toBe("error");
    expect(job.errorMessage).toBe("ffmpeg exited with code 1");
    expect(events).toEqual([{ type: "error", message: "ffmpeg exited with code 1" }]);
  });

  it("cancels a running job and kills its process", () => {
    const job = createJob("j-cancel", "/tmp/j-cancel", 10);
    const events = record(job.id);
    let killedWith: string | undefined;
    job.process = { kill: (signal: string) => void (killedWith = signal) } as never;
    cancelJob(job);
    expect(job.status).toBe("cancelled");
    expect(killedWith).toBe("SIGKILL");
    expect(events).toEqual([{ type: "cancelled" }]);
    cancelJob(job); // a second cancel is a no-op
    expect(events).toHaveLength(1);
  });

  it("sweeps finished jobs older than the limit, never running ones", () => {
    const old = createJob("j-old", "/tmp/j-old", 1);
    completeJob(old, "/tmp/j-old/output.mp4");
    old.createdAt = Date.now() - 10_000;
    const running = createJob("j-running", "/tmp/j-running", 1);
    running.createdAt = Date.now() - 10_000;
    const fresh = createJob("j-fresh", "/tmp/j-fresh", 1);
    completeJob(fresh, "/tmp/j-fresh/output.mp4");

    const deleted: string[] = [];
    sweepOldJobs(5_000, (job) => deleted.push(job.id));
    expect(deleted).toEqual(["j-old"]);
    expect(getJob("j-old")).toBeUndefined();
    expect(getJob("j-running")?.status).toBe("running");
    expect(getJob("j-fresh")?.status).toBe("done");
  });
});
