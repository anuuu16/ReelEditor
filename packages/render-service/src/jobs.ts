import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

export type JobStatus = "running" | "done" | "error" | "cancelled";

export type JobEvent =
  | { type: "progress"; percent: number }
  | { type: "done"; outputPath: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export interface Job {
  id: string;
  status: JobStatus;
  percent: number;
  totalDurationSeconds: number;
  workDir: string;
  outputPath: string | null;
  errorMessage: string | null;
  process: ChildProcess | null;
  createdAt: number;
  emitter: EventEmitter;
}

const jobs = new Map<string, Job>();

export function createJob(id: string, workDir: string, totalDurationSeconds: number): Job {
  const job: Job = {
    id,
    status: "running",
    percent: 0,
    totalDurationSeconds,
    workDir,
    outputPath: null,
    errorMessage: null,
    process: null,
    createdAt: Date.now(),
    emitter: new EventEmitter(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJobProgress(job: Job, percent: number): void {
  if (job.status !== "running") return;
  job.percent = percent;
  job.emitter.emit("update", { type: "progress", percent } satisfies JobEvent);
}

export function completeJob(job: Job, outputPath: string): void {
  if (job.status !== "running") return;
  job.status = "done";
  job.percent = 100;
  job.outputPath = outputPath;
  job.emitter.emit("update", { type: "done", outputPath } satisfies JobEvent);
}

export function failJob(job: Job, message: string): void {
  if (job.status !== "running") return;
  job.status = "error";
  job.errorMessage = message;
  job.emitter.emit("update", { type: "error", message } satisfies JobEvent);
}

export function cancelJob(job: Job): void {
  if (job.status !== "running") return;
  job.status = "cancelled";
  job.process?.kill("SIGKILL");
  job.emitter.emit("update", { type: "cancelled" } satisfies JobEvent);
}

export function sweepOldJobs(maxAgeMs: number, onDelete: (job: Job) => void): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== "running" && now - job.createdAt > maxAgeMs) {
      onDelete(job);
      jobs.delete(id);
    }
  }
}
