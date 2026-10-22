import { afterEach, describe, expect, it } from "vitest";
import { cancelJob, clearJobsForTests, completeJob, createJob, failJob, removeJob, type Job, type JobInit } from "./jobs.js";
import { DEFAULT_CAPACITY, defaultCapacity, jobCost, RenderQueue } from "./queue.js";

function makeJob(id: string, cost: number, overrides: Partial<JobInit> = {}): Job {
  return createJob({
    id,
    batchId: "b",
    projectId: "p",
    projectName: "Test",
    output: { width: 1080, height: 1920, format: "mp4", label: null },
    downloadName: `${id}.mp4`,
    workDir: `/tmp/${id}`,
    totalDurationSeconds: 10,
    plan: { args: [], outputFileName: "output.mp4", overlayTextFiles: [] },
    cost,
    ...overrides,
  });
}

let queue: RenderQueue | null = null;
afterEach(() => {
  queue?.dispose();
  queue = null;
  clearJobsForTests();
});

describe("defaultCapacity", () => {
  it("is one export at a time unless RENDER_CONCURRENCY says otherwise", () => {
    const saved = process.env.RENDER_CONCURRENCY;
    try {
      delete process.env.RENDER_CONCURRENCY;
      expect(DEFAULT_CAPACITY).toBe(1);
      expect(defaultCapacity()).toBe(1);
      process.env.RENDER_CONCURRENCY = "3";
      expect(defaultCapacity()).toBe(3);
      process.env.RENDER_CONCURRENCY = "0";
      expect(defaultCapacity()).toBe(1);
      process.env.RENDER_CONCURRENCY = "lots";
      expect(defaultCapacity()).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.RENDER_CONCURRENCY;
      else process.env.RENDER_CONCURRENCY = saved;
    }
  });
});

describe("jobCost", () => {
  it("calls short, small outputs cheap and anything 2K/4K exclusive", () => {
    expect(jobCost({ width: 720, height: 1280, format: "mp4" }, 30, 4)).toBe(1);
    expect(jobCost({ width: 1080, height: 1920, format: "mp4" }, 60, 4)).toBe(2); // medium: half the slots
    expect(jobCost({ width: 2160, height: 3840, format: "mp4" }, 10, 4)).toBe(4);
    expect(jobCost({ width: 1080, height: 1920, format: "mp4" }, 600, 4)).toBe(4); // long 1080p is large too
  });

  it("charges slow codecs more for the same picture", () => {
    expect(jobCost({ width: 720, height: 1280, format: "mp4" }, 60, 4)).toBe(1);
    expect(jobCost({ width: 720, height: 1280, format: "webm" }, 60, 4)).toBe(2);
  });

  it("never exceeds the capacity, and with one slot everything costs one", () => {
    expect(jobCost({ width: 2160, height: 3840, format: "mp4" }, 60, 1)).toBe(1);
    expect(jobCost({ width: 180, height: 320, format: "gif" }, 3, 1)).toBe(1);
    expect(jobCost({ width: 1080, height: 1920, format: "mp4" }, 60, 2)).toBe(1);
  });
});

describe("RenderQueue", () => {
  it("with the default single slot, runs jobs strictly one after another in the order they came", () => {
    queue = new RenderQueue(DEFAULT_CAPACITY);
    const started: string[] = [];
    const run = (job: Job) => started.push(job.id);
    const a = makeJob("a", 1);
    const b = makeJob("b", 1);
    const c = makeJob("c", 1);
    queue.enqueue(a, run);
    queue.enqueue(b, run);
    queue.enqueue(c, run);
    expect(started).toEqual(["a"]);
    expect([a.status, b.status, c.status]).toEqual(["running", "queued", "queued"]);
    expect([b.queuePosition, c.queuePosition]).toEqual([1, 2]);
    expect(queue.runningCount).toBe(1);

    completeJob(a, "/tmp/a/output.mp4");
    expect(started).toEqual(["a", "b"]);
    expect(queue.runningCount).toBe(1);
    expect(c.queuePosition).toBe(1);

    cancelJob(b); // the running one — its slot frees up for c at once
    expect(started).toEqual(["a", "b", "c"]);
    expect(c.status).toBe("running");
  });

  it("with extra slots (RENDER_CONCURRENCY), runs small jobs side by side, first come first served", () => {
    queue = new RenderQueue(2);
    const started: string[] = [];
    const run = (job: Job) => started.push(job.id);
    const a = makeJob("a", 1);
    const b = makeJob("b", 1);
    const c = makeJob("c", 1);
    queue.enqueue(a, run);
    queue.enqueue(b, run);
    queue.enqueue(c, run);
    expect(started).toEqual(["a", "b"]);
    expect(a.status).toBe("running");
    expect(c.status).toBe("queued");
    expect(c.queuePosition).toBe(1);

    completeJob(a, "/tmp/a/output.mp4");
    expect(started).toEqual(["a", "b", "c"]);
    expect(c.status).toBe("running");
    expect(c.queuePosition).toBeNull();
  });

  it("gives a large job the machine to itself, and doesn't let later small jobs overtake it", () => {
    queue = new RenderQueue(3);
    const started: string[] = [];
    const run = (job: Job) => started.push(job.id);
    const small = makeJob("small", 1);
    const large = makeJob("large", 3);
    const later = makeJob("later", 1);
    queue.enqueue(small, run);
    queue.enqueue(large, run);
    queue.enqueue(later, run);
    expect(started).toEqual(["small"]);
    expect(large.queuePosition).toBe(1);
    expect(later.queuePosition).toBe(2);

    completeJob(small, "/tmp/small/output.mp4");
    expect(started).toEqual(["small", "large"]);
    expect(later.status).toBe("queued");
    expect(later.queuePosition).toBe(1);

    failJob(large, "boom");
    expect(started).toEqual(["small", "large", "later"]);
  });

  it("drops a job cancelled while waiting and moves the line up", () => {
    queue = new RenderQueue(1);
    const started: string[] = [];
    const run = (job: Job) => started.push(job.id);
    const a = makeJob("a", 1);
    const b = makeJob("b", 1);
    const c = makeJob("c", 1);
    queue.enqueue(a, run);
    queue.enqueue(b, run);
    queue.enqueue(c, run);
    expect(c.queuePosition).toBe(2);
    cancelJob(b);
    expect(c.queuePosition).toBe(1);
    expect(queue.waitingCount).toBe(1);
    removeJob(a);
    expect(started).toEqual(["a", "c"]);
  });

  it("a job costing more than the capacity still runs (alone)", () => {
    queue = new RenderQueue(2);
    const started: string[] = [];
    const huge = makeJob("huge", 99);
    const next = makeJob("next", 1);
    queue.enqueue(huge, (job) => started.push(job.id));
    queue.enqueue(next, (job) => started.push(job.id));
    expect(started).toEqual(["huge"]);
    expect(queue.runningCount).toBe(1);
    completeJob(huge, "/tmp/huge/output.mp4");
    expect(started).toEqual(["huge", "next"]);
  });

  it("keeps going when a runner throws", () => {
    queue = new RenderQueue(1);
    const a = makeJob("a", 1);
    const b = makeJob("b", 1);
    const started: string[] = [];
    queue.enqueue(a, () => {
      throw new Error("spawn failed");
    });
    queue.enqueue(b, (job) => started.push(job.id));
    expect(a.status).toBe("running"); // the runner is expected to failJob itself; here it didn't
    failJob(a, "spawn failed");
    expect(started).toEqual(["b"]);
  });

  it("lets a waiting job be moved in the line, and the next free slot follows the new order", () => {
    queue = new RenderQueue(1);
    const started: string[] = [];
    const run = (job: Job) => started.push(job.id);
    const a = makeJob("a", 1);
    const b = makeJob("b", 1);
    const c = makeJob("c", 1);
    const d = makeJob("d", 1);
    for (const job of [a, b, c, d]) queue.enqueue(job, run);
    expect(queue.line.map((j) => j.id)).toEqual(["b", "c", "d"]);

    expect(queue.move(d, "front")).toBe(true);
    expect(queue.line.map((j) => j.id)).toEqual(["d", "b", "c"]);
    expect([d.queuePosition, b.queuePosition, c.queuePosition]).toEqual([1, 2, 3]);

    expect(queue.move(b, "down")).toBe(true);
    expect(queue.line.map((j) => j.id)).toEqual(["d", "c", "b"]);
    expect(queue.move(b, "up")).toBe(true);
    expect(queue.line.map((j) => j.id)).toEqual(["d", "b", "c"]);
    expect(queue.move(d, "back")).toBe(true);
    expect(queue.line.map((j) => j.id)).toEqual(["b", "c", "d"]);
    // At the ends, up/front/down/back are no-ops (still "moved": the job is in the line).
    expect(queue.move(b, "up")).toBe(true);
    expect(queue.move(d, "down")).toBe(true);
    expect(queue.line.map((j) => j.id)).toEqual(["b", "c", "d"]);
    // Every rank stays unique, so the order is never ambiguous.
    expect(new Set(queue.line.map((j) => j.queueRank)).size).toBe(3);

    // The running job and finished jobs can't be moved.
    expect(queue.move(a, "front")).toBe(false);
    queue.move(c, "front");
    completeJob(a, "/tmp/a/output.mp4");
    expect(started).toEqual(["a", "c"]); // the new front of the line went next
    expect(queue.move(a, "back")).toBe(false);
  });

  it("announces the new order on the jobs, so the editor and the disk see it", () => {
    queue = new RenderQueue(1);
    const run = () => {};
    const a = makeJob("a", 1);
    const b = makeJob("b", 1);
    const c = makeJob("c", 1);
    for (const job of [a, b, c]) queue.enqueue(job, run);
    const events: string[] = [];
    c.emitter.on("update", (e: { type: string }) => events.push(e.type));
    queue.move(c, "front");
    expect(events).toEqual(["reordered", "queued"]);
    expect(c.queueRank).toBeLessThan(b.queueRank);
  });

  it("queues a restored job by the rank it had, not by when it was re-created", () => {
    queue = new RenderQueue(1);
    const run = () => {};
    const running = makeJob("running", 1);
    queue.enqueue(running, run);
    const late = makeJob("late", 1, { queueRank: 500 });
    const early = makeJob("early", 1, { queueRank: 5 });
    queue.enqueue(late, run);
    queue.enqueue(early, run);
    expect(queue.line.map((j) => j.id)).toEqual(["early", "late"]);
    const fresh = makeJob("fresh", 1); // created after: goes behind everything restored
    queue.enqueue(fresh, run);
    expect(queue.line.map((j) => j.id)).toEqual(["early", "late", "fresh"]);
    expect(fresh.queueRank).toBeGreaterThan(500);
  });
});
