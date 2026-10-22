import { getOutputFormat, type OutputFormatId } from "@reel-studio/timeline-core";
import type { QueueMoveDirection } from "@reel-studio/shared-types";
import { isJobActive, jobEvents, setJobQueuePosition, setJobQueueRank, startJob, type Job } from "./jobs.js";

// How many exports run at once: one. This runs on someone's own laptop, next to the editor and
// whatever else they're doing, and a single ffmpeg already spreads one encode over every core —
// running two at once only makes both slower and doubles peak memory. So exports form a line and
// are rendered strictly in the order they were asked for, each one finishing before the next
// starts. (RENDER_CONCURRENCY=<n> in .env opts a bigger machine into n slots; then a job's cost —
// 1 for something small, up to n for a 4K render — decides what may share them.)

export const DEFAULT_CAPACITY = 1;
const MAX_CAPACITY = 8;

export function defaultCapacity(): number {
  const fromEnv = Number(process.env.RENDER_CONCURRENCY);
  if (Number.isInteger(fromEnv) && fromEnv >= 1) return Math.min(fromEnv, MAX_CAPACITY);
  return DEFAULT_CAPACITY;
}

// Only matters with more than one slot. Work is roughly pixels × seconds (× how slow the codec
// is): a 720p minute is small, a 1080p minute is medium, anything past that is large and gets the
// machine to itself. Anything bigger than 1080p is large whatever its length — it's the frame size,
// not the duration, that decides how much memory the filter graph holds.
const SMALL_MEGAPIXEL_SECONDS = 60;
const MEDIUM_MEGAPIXEL_SECONDS = 160;
const LARGE_FRAME_PIXELS = 1920 * 1080;

export function jobCost(
  output: { width: number; height: number; format: OutputFormatId },
  durationSeconds: number,
  capacity: number,
): number {
  if (capacity <= 1) return 1;
  const pixels = output.width * output.height;
  if (pixels > LARGE_FRAME_PIXELS) return capacity;
  const work = ((pixels * Math.max(durationSeconds, 1)) / 1e6) * getOutputFormat(output.format).encodeCostFactor;
  if (work <= SMALL_MEGAPIXEL_SECONDS) return 1;
  if (work <= MEDIUM_MEGAPIXEL_SECONDS) return Math.min(capacity, Math.max(1, Math.ceil(capacity / 2)));
  return capacity;
}

export type JobRunner = (job: Job) => void;

interface Waiting {
  job: Job;
  run: JobRunner;
}

export class RenderQueue {
  private readonly waiting: Waiting[] = [];
  private readonly running = new Map<string, Job>();

  private readonly onUpdate = (job: Job) => {
    if (!isJobActive(job)) this.release(job);
  };
  private readonly onRemoved = (job: Job) => this.release(job);

  constructor(readonly capacity: number) {
    jobEvents.on("update", this.onUpdate);
    jobEvents.on("removed", this.onRemoved);
  }

  dispose(): void {
    jobEvents.off("update", this.onUpdate);
    jobEvents.off("removed", this.onRemoved);
  }

  get runningCount(): number {
    return this.running.size;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  private get usedSlots(): number {
    let used = 0;
    for (const job of this.running.values()) used += Math.min(job.cost, this.capacity);
    return used;
  }

  enqueue(job: Job, run: JobRunner): void {
    if (job.status !== "queued") return;
    this.waiting.push({ job, run });
    this.pump();
  }

  /** The waiting jobs in the order they'll render. */
  get line(): Job[] {
    return this.waiting.map((w) => w.job);
  }

  /**
   * Moves a waiting job in the line. Ranks are what the line is sorted by, so "up"/"down" swap
   * ranks with the neighbour and "front"/"back" take a rank beyond the current extremes; the next
   * pump then renders (and announces) the new order. Returns false if the job isn't waiting.
   */
  move(job: Job, direction: QueueMoveDirection): boolean {
    this.sortWaiting();
    const index = this.waiting.findIndex((w) => w.job.id === job.id);
    if (index === -1 || job.status !== "queued") return false;
    const line = this.line;
    switch (direction) {
      case "front":
        if (index > 0) setJobQueueRank(job, line[0].queueRank - 1);
        break;
      case "back":
        if (index < line.length - 1) setJobQueueRank(job, line[line.length - 1].queueRank + 1);
        break;
      case "up":
        if (index > 0) this.swapRanks(job, line[index - 1]);
        break;
      case "down":
        if (index < line.length - 1) this.swapRanks(job, line[index + 1]);
        break;
    }
    this.pump();
    return true;
  }

  private swapRanks(a: Job, b: Job): void {
    const rankA = a.queueRank;
    const rankB = b.queueRank;
    // Go through a rank neither holds, so no two jobs ever share one in between.
    setJobQueueRank(a, Math.min(rankA, rankB) - 1);
    setJobQueueRank(b, rankA);
    setJobQueueRank(a, rankB);
  }

  private sortWaiting(): void {
    this.waiting.sort((x, y) => x.job.queueRank - y.job.queueRank);
  }

  /** Takes a job out of the line (when it's cancelled/removed before it ever started). */
  private release(job: Job): void {
    const index = this.waiting.findIndex((w) => w.job.id === job.id);
    if (index >= 0) this.waiting.splice(index, 1);
    const wasRunning = this.running.delete(job.id);
    if (wasRunning || index >= 0) this.pump();
  }

  private pump(): void {
    // Anything no longer queued (cancelled while waiting) just drops out of the line.
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      if (this.waiting[i].job.status !== "queued") this.waiting.splice(i, 1);
    }
    this.sortWaiting();
    while (this.waiting.length > 0) {
      const next = this.waiting[0];
      const cost = Math.min(next.job.cost, this.capacity);
      if (this.usedSlots + cost > this.capacity) break;
      this.waiting.shift();
      this.running.set(next.job.id, next.job);
      startJob(next.job);
      try {
        next.run(next.job);
      } catch (err) {
        // The runner reports failures through failJob itself; this is only a last resort.
        console.error(`Export ${next.job.id} failed to start:`, err);
      }
    }
    this.waiting.forEach((w, i) => setJobQueuePosition(w.job, i + 1));
  }
}

let queue: RenderQueue | null = null;

export function getRenderQueue(): RenderQueue {
  if (!queue) queue = new RenderQueue(defaultCapacity());
  return queue;
}

/** Test hook: a fresh queue with a given capacity. */
export function resetRenderQueueForTests(capacity: number): RenderQueue {
  queue?.dispose();
  queue = new RenderQueue(capacity);
  return queue;
}
