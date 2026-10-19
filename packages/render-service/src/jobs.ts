import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { ExportJobStatus, ExportJobSummary, ExportOutput } from "@reel-studio/shared-types";
import type { OverlayTextFile } from "@reel-studio/timeline-core";

// The in-memory registry of export jobs and their state machine:
//
//   queued ──▶ running ──▶ done
//     │           ├──────▶ error
//     └───────────┴──────▶ cancelled
//
// Every transition is announced twice: on the job's own emitter (the per-job SSE stream) and on
// `jobEvents` (the all-jobs stream, the queue, and the on-disk store all listen there). Nothing in
// this module touches the filesystem or spawns anything — see queue.ts, jobStore.ts and render.ts.

export type JobStatus = ExportJobStatus;

export const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(["queued", "running"]);

export type JobOutput = ExportOutput;

/** Everything the editor needs to show a job, and what gets written to job.json. */
export type JobSummary = ExportJobSummary;

/** The ffmpeg invocation, kept so a job can be re-run as-is after a service restart. */
export interface JobPlan {
  args: string[];
  outputFileName: string;
  overlayTextFiles: OverlayTextFile[];
  /** Source name by input file path, for error messages that can say which file went wrong. */
  sourceLabels?: Record<string, string>;
}

export interface Job extends JobSummary {
  /** Creation order, so a batch created in one go lists in the order its outputs were asked for. */
  seq: number;
  workDir: string;
  outputPath: string | null;
  plan: JobPlan;
  process: ChildProcess | null;
  emitter: EventEmitter;
}

export type JobEvent =
  | { type: "queued"; position: number }
  | { type: "reordered"; queueRank: number }
  | { type: "started" }
  | { type: "progress"; percent: number }
  | { type: "done"; outputPath: string; downloadName: string; outputBytes: number | null; warning: string | null }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export interface JobInit {
  id: string;
  batchId: string;
  batchIndex?: number;
  projectId: string;
  projectName: string;
  output: JobOutput;
  downloadName: string;
  workDir: string;
  totalDurationSeconds: number;
  plan: JobPlan;
  cost?: number;
  createdAt?: number;
  queueRank?: number;
}

/** Fires ("update", job, event) for every job; also ("removed", job) when one is deleted. */
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(0);

const jobs = new Map<string, Job>();
let nextSeq = 0;
// Ranks only ever grow for new jobs, so a job created after a restart lines up behind the ones
// restored from disk (whose ranks are whatever they were before).
let nextRank = 1;

export function createJob(init: JobInit): Job {
  const job: Job = {
    seq: nextSeq++,
    id: init.id,
    batchId: init.batchId,
    batchIndex: init.batchIndex ?? 0,
    projectId: init.projectId,
    projectName: init.projectName,
    output: init.output,
    downloadName: init.downloadName,
    status: "queued",
    percent: 0,
    totalDurationSeconds: init.totalDurationSeconds,
    errorMessage: null,
    warning: null,
    createdAt: init.createdAt ?? Date.now(),
    startedAt: null,
    finishedAt: null,
    outputBytes: null,
    cost: init.cost ?? 1,
    queuePosition: null,
    queueRank: init.queueRank ?? nextRank,
    workDir: init.workDir,
    outputPath: null,
    plan: init.plan,
    process: null,
    emitter: new EventEmitter(),
  };
  job.emitter.setMaxListeners(0);
  nextRank = Math.max(nextRank, job.queueRank + 1);
  jobs.set(job.id, job);
  return job;
}

/** Re-registers a job read back from disk (see jobStore.ts) in whatever state it was saved in. */
export function restoreJob(record: JobSummary, workDir: string, outputPath: string | null, plan: JobPlan): Job {
  const job = createJob({ ...record, workDir, plan });
  job.status = record.status;
  job.percent = record.percent;
  job.errorMessage = record.errorMessage;
  job.warning = record.warning ?? null;
  job.startedAt = record.startedAt;
  job.finishedAt = record.finishedAt;
  job.outputBytes = record.outputBytes;
  job.outputPath = outputPath;
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Newest first. */
export function listJobs(filter?: { projectId?: string; batchId?: string }): Job[] {
  const all = [...jobs.values()].filter(
    (job) => (!filter?.projectId || job.projectId === filter.projectId) && (!filter?.batchId || job.batchId === filter.batchId),
  );
  return all.sort((a, b) => b.createdAt - a.createdAt || a.batchIndex - b.batchIndex || a.seq - b.seq);
}

export function isJobActive(job: Job): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

/** Failed or cancelled: can be run again with the same settings, as long as its uploads are kept. */
export function isJobRetryable(job: Job): boolean {
  return job.status === "error" || job.status === "cancelled";
}

export function toJobSummary(job: Job): JobSummary {
  return {
    id: job.id,
    batchId: job.batchId,
    batchIndex: job.batchIndex,
    projectId: job.projectId,
    projectName: job.projectName,
    output: job.output,
    downloadName: job.downloadName,
    status: job.status,
    percent: job.percent,
    totalDurationSeconds: job.totalDurationSeconds,
    errorMessage: job.errorMessage,
    warning: job.warning,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    outputBytes: job.outputBytes,
    cost: job.cost,
    queuePosition: job.queuePosition,
    queueRank: job.queueRank,
  };
}

function emit(job: Job, event: JobEvent): void {
  job.emitter.emit("update", event);
  jobEvents.emit("update", job, event);
}

export function setJobQueuePosition(job: Job, position: number): void {
  if (job.status !== "queued") return;
  if (job.queuePosition === position) return;
  job.queuePosition = position;
  emit(job, { type: "queued", position });
}

/** Moves a waiting job in the line (the queue decides the rank; this records and announces it). */
export function setJobQueueRank(job: Job, queueRank: number): void {
  if (job.status !== "queued" || job.queueRank === queueRank) return;
  job.queueRank = queueRank;
  emit(job, { type: "reordered", queueRank });
}

export function startJob(job: Job): void {
  if (job.status !== "queued") return;
  job.status = "running";
  job.queuePosition = null;
  job.startedAt = Date.now();
  emit(job, { type: "started" });
}

export function updateJobProgress(job: Job, percent: number): void {
  if (job.status !== "running") return;
  job.percent = percent;
  emit(job, { type: "progress", percent });
}

export function completeJob(job: Job, outputPath: string, outputBytes: number | null = null, warning: string | null = null): void {
  if (job.status !== "running") return;
  job.status = "done";
  job.percent = 100;
  job.outputPath = outputPath;
  job.outputBytes = outputBytes;
  job.warning = warning;
  job.finishedAt = Date.now();
  job.process = null;
  emit(job, { type: "done", outputPath, downloadName: job.downloadName, outputBytes, warning });
}

export function failJob(job: Job, message: string): void {
  if (!isJobActive(job)) return;
  job.status = "error";
  job.queuePosition = null;
  job.errorMessage = message;
  job.finishedAt = Date.now();
  job.process = null;
  emit(job, { type: "error", message });
}

export function cancelJob(job: Job): void {
  if (!isJobActive(job)) return;
  job.status = "cancelled";
  job.queuePosition = null;
  job.finishedAt = Date.now();
  job.process?.kill("SIGKILL");
  job.process = null;
  emit(job, { type: "cancelled" });
}

/** Drops a job from the registry (cancelling it first if it's still going). Files are the store's job. */
export function removeJob(job: Job): void {
  cancelJob(job);
  if (jobs.delete(job.id)) jobEvents.emit("removed", job);
}

export function sweepOldJobs(maxAgeMs: number, onDelete: (job: Job) => void): void {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (isJobActive(job)) continue;
    const finishedAt = job.finishedAt ?? job.createdAt;
    if (now - finishedAt > maxAgeMs) {
      onDelete(job);
      jobs.delete(job.id);
      jobEvents.emit("removed", job);
    }
  }
}

/** Test hook: forget every job without touching anything on disk. */
export function clearJobsForTests(): void {
  jobs.clear();
}
