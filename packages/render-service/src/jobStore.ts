import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandHome, PROJECTS_ROOT } from "./projects.js";
import {
  isJobActive,
  isJobRetryable,
  jobEvents,
  listJobs,
  restoreJob,
  toJobSummary,
  type Job,
  type JobEvent,
  type JobPlan,
  type JobSummary,
} from "./jobs.js";

// Where exports live on disk, and the job.json beside each one that lets the service pick every
// job back up after a restart:
//
//   <EXPORTS_ROOT>/<batchId>/media/<sourceId>.<ext>   the uploaded files, shared by the batch
//   <EXPORTS_ROOT>/<batchId>/<jobId>/job.json          state + the exact ffmpeg plan
//   <EXPORTS_ROOT>/<batchId>/<jobId>/output.<ext>      the finished file, served by /result
//
// It sits inside ~/ReelStudioProjects rather than the OS temp dir on purpose: a render that was
// running when the service went down has to find its uploads again when it comes back, and a
// finished file has to still be there when the person returns to download it — neither survives
// a temp-dir sweep or a reboot. REEL_EXPORTS_ROOT moves it somewhere else (tests use this).

export const EXPORTS_ROOT = process.env.REEL_EXPORTS_ROOT ? expandHome(process.env.REEL_EXPORTS_ROOT) : path.join(PROJECTS_ROOT, "exports");

const JOB_FILE = "job.json";
const MEDIA_DIR = "media";

/** Batch directories are UUIDs; anything else in EXPORTS_ROOT is not ours to touch. */
const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function batchDir(batchId: string): string {
  return path.join(EXPORTS_ROOT, batchId);
}

export function batchMediaDir(batchId: string): string {
  return path.join(batchDir(batchId), MEDIA_DIR);
}

export function jobDir(batchId: string, jobId: string): string {
  return path.join(batchDir(batchId), jobId);
}

interface JobRecord extends JobSummary {
  /** Relative to the job's directory, so the whole exports folder can move without breaking. */
  outputFileName: string | null;
  /** The ffmpeg process, while one is running — so a crash's orphan can be found and stopped. */
  pid: number | null;
  plan: JobPlan;
}

function toRecord(job: Job): JobRecord {
  return {
    ...toJobSummary(job),
    queuePosition: null,
    outputFileName: job.outputPath ? path.basename(job.outputPath) : null,
    pid: job.process?.pid ?? null,
    plan: job.plan,
  };
}

// If the service died without warning (a crash, a SIGKILL), the ffmpeg it had running carries on
// as an orphan, still writing into the job folder the re-run is about to render into. Before the
// re-run starts, that process is stopped — but only once its command line proves it's ffmpeg
// working on this very batch, since a pid can have been reused by anything since then.
function killOrphanedFfmpeg(pid: number, batchId: string): boolean {
  try {
    const args = spawnSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" }).stdout ?? "";
    if (!args.includes("ffmpeg") || !args.includes(batchId)) return false;
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

// Written whole and renamed into place, so a crash mid-write can never leave a half-written
// job.json for the next start to choke on. (The temp name is unique per write: two writes of the
// same job can overlap, and the rename of one must not steal the other's half-written file.)
let writeCounter = 0;
export async function writeJobFile(job: Job): Promise<void> {
  await mkdir(job.workDir, { recursive: true });
  const target = path.join(job.workDir, JOB_FILE);
  const tmp = `${target}.${process.pid}.${writeCounter++}.tmp`;
  await writeFile(tmp, JSON.stringify(toRecord(job), null, 2), "utf8");
  await rename(tmp, target);
}

export async function removeJobFiles(job: Job): Promise<void> {
  await rm(job.workDir, { recursive: true, force: true });
  await removeBatchDirIfEmpty(job.batchId);
}

/**
 * Whether a batch's uploads still have a use: something in it has yet to render, or something
 * failed/was cancelled and may be retried (a retry re-runs the same plan over the same files).
 * Once every job is done — or the failed ones have been removed — the uploads are dead weight.
 */
export function batchNeedsMedia(batchId: string): boolean {
  return listJobs({ batchId }).some((job) => isJobActive(job) || isJobRetryable(job));
}

export async function removeBatchMediaIfIdle(batchId: string): Promise<void> {
  if (batchNeedsMedia(batchId)) return;
  await rm(batchMediaDir(batchId), { recursive: true, force: true });
}

export function batchMediaExists(batchId: string): boolean {
  return existsSync(batchMediaDir(batchId));
}

/** Once the last job of a batch is gone, nothing refers to the batch folder any more. */
export async function removeBatchDirIfEmpty(batchId: string): Promise<void> {
  if (listJobs({ batchId }).length > 0) return;
  await rm(batchDir(batchId), { recursive: true, force: true });
}

export async function removeBatchDir(batchId: string): Promise<void> {
  await rm(batchDir(batchId), { recursive: true, force: true });
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return null;
  }
}

/**
 * Reads every job.json under EXPORTS_ROOT back into the registry. Jobs that were queued or
 * running when the service stopped come back as queued (their uploads are still there, so they
 * simply render again from the start); finished ones whose output file has gone missing are
 * marked failed rather than offering a download that 404s. Returns the jobs that need re-running.
 */
export async function loadPersistedJobs(): Promise<Job[]> {
  let batchIds: string[];
  try {
    batchIds = (await readdir(EXPORTS_ROOT)).filter((name) => BATCH_ID_PATTERN.test(name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const records: Array<{ record: JobRecord; workDir: string }> = [];
  for (const batchId of batchIds) {
    let entries: string[];
    try {
      entries = await readdir(batchDir(batchId));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === MEDIA_DIR) continue;
      const workDir = jobDir(batchId, entry);
      try {
        const raw = await readFile(path.join(workDir, JOB_FILE), "utf8");
        const record = JSON.parse(raw) as JobRecord;
        if (record.id === entry && record.batchId === batchId && record.plan?.args) records.push({ record, workDir });
      } catch {
        // Not a job directory (or a job.json we can't read) — left for sweepOrphanDirs.
      }
    }
  }

  // Oldest first — and within a batch (one createdAt) in the order its outputs were asked for — so
  // the queue after a restart is exactly the queue before it.
  records.sort((a, b) => a.record.createdAt - b.record.createdAt || (a.record.batchIndex ?? 0) - (b.record.batchIndex ?? 0));

  const toResume: Job[] = [];
  for (const { record, workDir } of records) {
    const outputPath = record.outputFileName ? path.join(workDir, record.outputFileName) : null;
    const job = restoreJob(record, workDir, outputPath, record.plan);
    if (record.status === "queued" || record.status === "running") {
      if (record.pid && killOrphanedFfmpeg(record.pid, record.batchId)) {
        console.log(`Stopped an orphaned ffmpeg (pid ${record.pid}) left over from export ${record.id}`);
      }
      job.status = "queued";
      job.percent = 0;
      job.startedAt = null;
      job.outputPath = null;
      toResume.push(job);
    } else if (record.status === "done") {
      const size = outputPath ? await fileSize(outputPath) : null;
      if (size === null) {
        job.status = "error";
        job.errorMessage = "The exported file is no longer on disk — export again.";
        job.outputPath = null;
      } else {
        job.outputBytes = size;
      }
    }
  }
  return toResume;
}

/**
 * Deletes what no job accounts for: a batch folder with no job.json in it (an upload that was
 * interrupted, or rejected while the service was going down) and stray entries inside a batch.
 * Only touches things older than `minAgeMs`, so an upload in progress right now is left alone.
 */
export async function sweepOrphanDirs(minAgeMs: number): Promise<string[]> {
  let batchIds: string[];
  try {
    batchIds = (await readdir(EXPORTS_ROOT)).filter((name) => BATCH_ID_PATTERN.test(name));
  } catch {
    return [];
  }
  const removed: string[] = [];
  const now = Date.now();
  for (const batchId of batchIds) {
    const dir = batchDir(batchId);
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(dir)).mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs < minAgeMs) continue;
    const known = listJobs({ batchId });
    if (known.length === 0) {
      await rm(dir, { recursive: true, force: true });
      removed.push(dir);
      continue;
    }
    // Inside a live batch: only its jobs' folders (and the media folder while anything still runs) belong.
    const keep = new Set(known.map((job) => job.id));
    if (batchNeedsMedia(batchId)) keep.add(MEDIA_DIR);
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (keep.has(entry)) continue;
      const stray = path.join(dir, entry);
      await rm(stray, { recursive: true, force: true });
      removed.push(stray);
    }
  }
  return removed;
}

// Keeps job.json current. Progress ticks arrive a couple of times a second per running job —
// writing each would be pointless churn, so they're coalesced to one write per second, while
// every status change is written immediately (that's what a restart needs to be right about).
const PROGRESS_WRITE_INTERVAL_MS = 1000;
const lastProgressWrite = new Map<string, number>();
const pendingWrites = new Map<string, Promise<void>>();

function persist(job: Job): Promise<void> {
  const previous = pendingWrites.get(job.id) ?? Promise.resolve();
  const next = previous
    .then(() => writeJobFile(job))
    .catch((err) => console.error(`Couldn't save export state for ${job.id}:`, err))
    .finally(() => {
      if (pendingWrites.get(job.id) === next) pendingWrites.delete(job.id);
    });
  pendingWrites.set(job.id, next);
  return next;
}

/** Waits for any in-flight job.json writes to land (tests, and a clean shutdown). */
export async function flushJobWrites(): Promise<void> {
  await Promise.all(pendingWrites.values());
}

let installed = false;

/** Hooks the store up to the registry: one call at startup, before any job is created. */
export function installJobPersistence(): void {
  if (installed) return;
  installed = true;
  jobEvents.on("update", (job: Job, event: JobEvent) => {
    if (event.type === "progress") {
      const last = lastProgressWrite.get(job.id) ?? 0;
      if (Date.now() - last < PROGRESS_WRITE_INTERVAL_MS) return;
      lastProgressWrite.set(job.id, Date.now());
      void persist(job);
      return;
    }
    if (event.type === "queued") return; // position is transient, not worth a write
    // "started" is written before ffmpeg exists; the very first progress tick (written at once,
    // since the throttle window starts empty) is what records its pid.
    lastProgressWrite.delete(job.id);
    void persist(job);
    if (!isJobActive(job)) void removeBatchMediaIfIdle(job.batchId);
  });
  jobEvents.on("removed", (job: Job) => {
    lastProgressWrite.delete(job.id);
    const pending = pendingWrites.get(job.id) ?? Promise.resolve();
    // Any write still in flight must land first, or it would recreate the directory we just removed.
    void pending
      .then(() => removeJobFiles(job))
      // Removing a failed job may have been the last reason to keep the batch's uploads around.
      .then(() => removeBatchMediaIfIdle(job.batchId))
      .catch((err) => console.error(`Couldn't delete export ${job.id}:`, err));
  });
}
