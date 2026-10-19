import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectModel } from "@reel-studio/shared-types";
import {
  buildDownloadName,
  buildFfmpegPlan,
  dedupeFileNames,
  type OutputFormatId,
  type OverlayTextFile,
  type RenderPlan,
} from "@reel-studio/timeline-core";
import { FFMPEG_PATH } from "./ffmpegBinary.js";
import { createProgressParser } from "./ffmpegProgress.js";
import { completeJob, createJob, failJob, isJobActive, removeJob, updateJobProgress, type Job, type JobOutput } from "./jobs.js";
import { batchMediaExists, jobDir, writeJobFile } from "./jobStore.js";
import { probeDurationSeconds, probeSources } from "./probeMedia.js";
import { getRenderQueue, jobCost } from "./queue.js";

const STDERR_TAIL_LIMIT = 4000;
// How much shorter than the timeline a finished file may be before that's worth a warning.
// (Container rounding is well under this; a damaged clip that cut out early is well over.)
const SHORT_OUTPUT_TOLERANCE_SECONDS = 0.5;

/** Names used in messages: the project's source name, or the bare file name as a fallback. */
export type SourceLabels = Record<string, string>;

// ffmpeg's own words for "this input is damaged", seen on a file the up-front probe could open
// (a clip cut off part-way through, a corrupt frame). It says them even when it goes on to exit
// 0 — the plan pads every clip to its full length, so a clip that ends early comes out as a
// frozen frame and silence rather than a failure — which is exactly when they're worth relaying.
const DAMAGE_PATTERNS = [
  /partial file/,
  /Invalid data found when processing input/,
  /Error while decoding/,
  /Error submitting packet to decoder/,
  /Invalid NAL unit/,
  /corrupt/i,
  /missing picture/,
];
const MAX_DAMAGE_LINES = 40;

export interface DamageReport {
  /** Names of the inputs ffmpeg complained about (where the line said which). */
  labels: string[];
  lines: string[];
}

/**
 * Watches ffmpeg's stderr line by line for complaints about an input, and works out which file
 * each is about: ffmpeg tags decoder messages with the input index (`[vist#2:0/h264 @ …]`,
 * `Input #2, …`), which is the position of that file among the `-i` arguments.
 */
export function createDamageDetector(inputPaths: string[], sourceLabels: SourceLabels) {
  let buffer = "";
  const lines: string[] = [];
  const inputs = new Set<number>();
  let unattributed = false;

  function consider(line: string) {
    if (!DAMAGE_PATTERNS.some((pattern) => pattern.test(line))) return;
    if (lines.length < MAX_DAMAGE_LINES) lines.push(line);
    const tagged = /\[(?:vist|aist|in)#(\d+)[:/]/.exec(line) ?? /Input #(\d+)/.exec(line);
    const byPath = inputPaths.findIndex((filePath) => line.includes(filePath));
    if (tagged) inputs.add(Number(tagged[1]));
    else if (byPath !== -1) inputs.add(byPath);
    else unattributed = true;
  }

  return {
    feed(chunk: string) {
      buffer += chunk;
      const parts = buffer.split(/\r?\n|\r/);
      buffer = parts.pop() ?? "";
      for (const line of parts) consider(line);
    },
    report(): DamageReport | null {
      if (buffer) {
        consider(buffer);
        buffer = "";
      }
      if (lines.length === 0) return null;
      const labels = [
        ...new Set([...inputs].map((i) => sourceLabels[inputPaths[i]] ?? path.basename(inputPaths[i] ?? "")).filter(Boolean)),
      ];
      return { labels: unattributed && labels.length === 0 ? [] : labels, lines };
    },
  };
}

function describeCulprits(report: DamageReport): string {
  return report.labels.length > 0 ? report.labels.map((l) => `"${l}"`).join(", ") : "one of the source files";
}

export function explainFfmpegFailure(code: number | null, stderrTail: string, damage: DamageReport | null): string {
  if (stderrTail.includes("No such filter: 'drawtext'")) {
    return (
      "This project has title overlays, but ffmpeg was built without drawtext (libfreetype) support — " +
      "Homebrew's plain ffmpeg formula excludes it. Run `brew install ffmpeg-full && brew link --overwrite ffmpeg-full` " +
      "to get a build that supports titles, then retry."
    );
  }
  if (damage) {
    return `ffmpeg couldn't read ${describeCulprits(damage)} all the way through — the file may be damaged or incomplete. Re-import it and try again.\n\n${stderrTail}`;
  }
  return `ffmpeg exited with code ${code}.\n${stderrTail}`;
}

/** Finished, but ffmpeg hit unreadable data in an input on the way: the result has a hole in it. */
export function damagedInputWarning(damage: DamageReport | null): string | null {
  if (!damage) return null;
  return (
    `ffmpeg hit unreadable data in ${describeCulprits(damage)} while rendering — that part of the result is a frozen frame and silence. ` +
    `The file is probably damaged or cut short; re-import it and export again.\n${damage.lines.slice(0, 3).join("\n")}`
  );
}

/** Every `-i` argument of the plan, in ffmpeg's input order. */
export function inputPathsOf(args: string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === "-i") paths.push(args[i + 1]);
  return paths;
}

/** A file that plays noticeably shorter than the timeline it was rendered from: say so rather than hand it over as if all were well. */
export function shortOutputWarning(expectedSeconds: number, actualSeconds: number | null): string | null {
  if (actualSeconds === null || expectedSeconds - actualSeconds <= SHORT_OUTPUT_TOLERANCE_SECONDS) return null;
  return `The file came out ${actualSeconds.toFixed(1)}s long, not the ${expectedSeconds.toFixed(1)}s the timeline is — a source clip may be damaged or cut short. Check it before sharing.`;
}

async function writeOverlayTextFiles(workDir: string, files: OverlayTextFile[]): Promise<void> {
  await Promise.all(files.map((file) => writeFile(path.join(workDir, file.fileName), file.content, "utf8")));
}

function spawnFfmpeg(job: Job): void {
  const { plan, workDir } = job;
  const ffmpeg = spawn(FFMPEG_PATH, plan.args, { cwd: workDir });
  job.process = ffmpeg;

  const feed = createProgressParser((update) => {
    const percent = job.totalDurationSeconds > 0 ? Math.min(100, Math.round((update.outTimeSeconds / job.totalDurationSeconds) * 100)) : 0;
    updateJobProgress(job, percent);
  });

  ffmpeg.stdout.on("data", (chunk: Buffer) => feed(chunk.toString("utf8")));

  let stderrTail = "";
  const damage = createDamageDetector(inputPathsOf(plan.args), plan.sourceLabels ?? {});
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    damage.feed(text);
    stderrTail += text;
    if (stderrTail.length > STDERR_TAIL_LIMIT) stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
  });

  const outputPath = path.join(workDir, plan.outputFileName);

  ffmpeg.on("error", (err) => {
    failJob(job, `Failed to start ffmpeg: ${err.message}. Is ffmpeg installed and on PATH?`);
  });

  ffmpeg.on("close", (code) => {
    if (job.status !== "running") {
      // Cancelled (or failed some other way) while encoding: the half-written file is of no use.
      rm(outputPath, { force: true }).catch(() => {});
      return;
    }
    if (code === 0) {
      // Size for the listing, and a read-back of the duration: ffmpeg exits 0 for a damaged input
      // that simply ended early, so "done" alone isn't proof the file is what was asked for.
      Promise.all([
        stat(outputPath)
          .then((info) => info.size)
          .catch(() => null),
        probeDurationSeconds(outputPath),
      ])
        .then(([size, duration]) =>
          completeJob(
            job,
            outputPath,
            size,
            damagedInputWarning(damage.report()) ?? shortOutputWarning(job.totalDurationSeconds, duration),
          ),
        )
        .catch(() => completeJob(job, outputPath));
      return;
    }
    rm(outputPath, { force: true }).catch(() => {});
    failJob(job, explainFfmpegFailure(code, stderrTail, damage.report()));
  });
}

// What the queue calls once a job's turn comes: (re)writes the title text files ffmpeg reads by
// relative path, then starts the encode. Also how a job picked up after a restart is re-run.
export function runJob(job: Job): void {
  mkdir(job.workDir, { recursive: true })
    .then(() => writeOverlayTextFiles(job.workDir, job.plan.overlayTextFiles))
    .then(() => {
      if (job.status !== "running") return;
      spawnFfmpeg(job);
    })
    .catch((err) => failJob(job, `Failed to prepare title overlays: ${err instanceof Error ? err.message : String(err)}`));
}

export function enqueueJob(job: Job): void {
  getRenderQueue().enqueue(job, runJob);
}

export interface RenderOutputRequest {
  width: number;
  height: number;
  format: OutputFormatId;
  label?: string | null;
}

/**
 * Turns one upload plus a list of outputs into one job per output, all sharing the uploaded files.
 * Throws (before any job exists) when the project can't be turned into a render plan, so the
 * caller can answer the request with a 400 and the message — and delete the upload.
 */
export async function startRenderBatch(
  batchId: string,
  project: ProjectModel,
  sourcePaths: Record<string, string>,
  outputs: RenderOutputRequest[],
): Promise<Job[]> {
  // Every file gets one look from ffmpeg before anything is queued: a file it can't open at all
  // (garbage, an upload cut off before the index, an empty image) would otherwise become one
  // failed job per output, each with a page of ffmpeg output as its only explanation. This is also
  // where a video turns out to have no audio track (a screen recording), which the plan needs to
  // know so it doesn't reference a stream that isn't there.
  const sourceLabels: SourceLabels = {};
  for (const [sourceId, filePath] of Object.entries(sourcePaths)) {
    sourceLabels[filePath] = project.sources.find((s) => s.id === sourceId)?.name ?? path.basename(filePath);
  }
  const probed = await probeSources(sourcePaths);
  const unreadable = Object.entries(probed)
    .filter(([, info]) => !info.readable)
    .map(([sourceId]) => `"${sourceLabels[sourcePaths[sourceId]]}"`);
  if (unreadable.length > 0) {
    throw new Error(
      `${unreadable.join(", ")} can't be read as media — the file may be damaged, incomplete or not a video/audio/image file at all. Re-import it and try again.`,
    );
  }
  const imageSourceIds = new Set(project.sources.filter((s) => s.kind === "image").map((s) => s.id));
  const sourceHasAudio = Object.fromEntries(
    Object.entries(probed)
      .filter(([sourceId]) => !imageSourceIds.has(sourceId))
      .map(([sourceId, info]) => [sourceId, info.hasAudio]),
  );

  // Every plan is built (and can fail) before the first job is created, so a bad request never
  // leaves a half-created batch behind.
  const plans: RenderPlan[] = outputs.map((output) =>
    buildFfmpegPlan({
      project,
      sourcePaths,
      sourceHasAudio,
      output: { width: output.width, height: output.height, format: output.format },
    }),
  );

  const projectName = project.metadata?.name?.trim() || "reel";
  const downloadNames = dedupeFileNames(
    outputs.map((output) =>
      buildDownloadName({ projectName, width: output.width, height: output.height, format: output.format, label: output.label }),
    ),
  );

  const queue = getRenderQueue();
  const createdAt = Date.now();
  const jobs: Job[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const output: JobOutput = {
      width: outputs[i].width,
      height: outputs[i].height,
      format: outputs[i].format,
      label: outputs[i].label?.trim() || null,
    };
    const id = randomUUID();
    const job = createJob({
      id,
      batchId,
      batchIndex: i,
      projectId: project.id,
      projectName,
      output,
      downloadName: downloadNames[i],
      workDir: jobDir(batchId, id),
      totalDurationSeconds: plans[i].totalDurationSeconds,
      plan: { args: plans[i].args, outputFileName: plans[i].outputFileName, overlayTextFiles: plans[i].overlayTextFiles, sourceLabels },
      cost: jobCost(output, plans[i].totalDurationSeconds, queue.capacity),
      // Same timestamp, so "newest first" listings keep a batch together in the order it was asked for.
      createdAt,
    });
    jobs.push(job);
  }

  // The manifests exist on disk before the first encode starts: from here on a restart can always
  // pick the batch back up.
  await Promise.all(jobs.map((job) => writeJobFile(job)));
  for (const job of jobs) enqueueJob(job);
  return jobs;
}

export class RetryUnavailableError extends Error {}

/**
 * Runs a failed or cancelled export again with exactly the same settings: a fresh job (new id,
 * clean folder) with the same plan over the same uploads, taking the old one's place in the list.
 * Throws RetryUnavailableError when that isn't possible — the job is still going, or its uploads
 * are gone (they're kept as long as anything in the batch can be retried, see batchNeedsMedia).
 */
export async function retryJob(job: Job): Promise<Job> {
  if (isJobActive(job)) throw new RetryUnavailableError("This export is still in progress.");
  if (!batchMediaExists(job.batchId)) {
    throw new RetryUnavailableError("The files this export was made from are no longer on the service — export it again from the editor.");
  }
  const id = randomUUID();
  const replacement = createJob({
    id,
    batchId: job.batchId,
    batchIndex: job.batchIndex,
    projectId: job.projectId,
    projectName: job.projectName,
    output: job.output,
    downloadName: job.downloadName,
    workDir: jobDir(job.batchId, id),
    totalDurationSeconds: job.totalDurationSeconds,
    plan: job.plan,
    cost: job.cost,
  });
  // The replacement exists before the old record goes, so the batch never looks empty in between.
  removeJob(job);
  await writeJobFile(replacement);
  enqueueJob(replacement);
  return replacement;
}
