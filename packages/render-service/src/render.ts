import { spawn } from "node:child_process";
import path from "node:path";
import type { ProjectModel } from "@reel-studio/shared-types";
import { buildFfmpegPlan } from "@reel-studio/timeline-core";
import { createProgressParser } from "./ffmpegProgress.js";
import { completeJob, createJob, failJob, updateJobProgress, type Job } from "./jobs.js";

const STDERR_TAIL_LIMIT = 4000;

export function startRenderJob(
  jobId: string,
  project: ProjectModel,
  sourcePaths: Record<string, string>,
  workDir: string
): Job {
  const plan = buildFfmpegPlan({ project, sourcePaths });
  const job = createJob(jobId, workDir, plan.totalDurationSeconds);

  const ffmpeg = spawn("ffmpeg", plan.args, { cwd: workDir });
  job.process = ffmpeg;

  const feed = createProgressParser((update) => {
    const percent =
      plan.totalDurationSeconds > 0 ? Math.min(100, Math.round((update.outTimeSeconds / plan.totalDurationSeconds) * 100)) : 0;
    updateJobProgress(job, percent);
  });

  ffmpeg.stdout.on("data", (chunk: Buffer) => feed(chunk.toString("utf8")));

  let stderrTail = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderrTail += chunk.toString("utf8");
    if (stderrTail.length > STDERR_TAIL_LIMIT) stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
  });

  ffmpeg.on("error", (err) => {
    failJob(job, `Failed to start ffmpeg: ${err.message}. Is ffmpeg installed and on PATH?`);
  });

  ffmpeg.on("close", (code) => {
    if (job.status !== "running") return;
    if (code === 0) {
      completeJob(job, path.join(workDir, plan.outputFileName));
    } else {
      failJob(job, `ffmpeg exited with code ${code}.\n${stderrTail}`);
    }
  });

  return job;
}
