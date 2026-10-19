import "./env.js";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, copyFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { ProjectModel } from "@reel-studio/shared-types";
import {
  cancelJob,
  getJob,
  isJobActive,
  jobEvents,
  listJobs,
  removeJob,
  sweepOldJobs,
  toJobSummary,
  type Job,
  type JobEvent,
} from "./jobs.js";
import {
  batchMediaDir,
  installJobPersistence,
  loadPersistedJobs,
  removeBatchDir,
  removeBatchMediaIfIdle,
  sweepOrphanDirs,
} from "./jobStore.js";
import { commitUpload, jsonErrorHandler, onUploadAbandoned } from "./uploadCleanup.js";
import {
  deleteProjectDir,
  discardProjectUpload,
  findMediaFilePath,
  isValidProjectId,
  listProjects,
  mediaDir,
  pruneUnreferencedMedia,
  readProjectFile,
  saveProjectFile,
} from "./projects.js";
import { audioEditUpload, handleAudioEdit } from "./audioEdit.js";
import { enqueueJob, retryJob, RetryUnavailableError, startRenderBatch, type RenderOutputRequest } from "./render.js";
import { fingerprintFile, listProjectMedia } from "./mediaFingerprint.js";
import { getRenderQueue } from "./queue.js";
import { DEFAULT_OUTPUT_FORMAT, isOutputFormatId } from "@reel-studio/timeline-core";
import { createRhymeRouter } from "./rhymeRoutes.js";
import {
  aspectAndFormat,
  creditsPerClipForModel,
  generateSocialMetadata,
  generateStudioProject,
  type GenerateParams,
} from "./studioGenerate.js";
import {
  deleteStudioDir,
  findStudioResourceFilePath,
  isValidStudioId,
  listStudioProjects,
  readStudioProjectFile,
  saveStudioProjectFile,
  studioResourcesDir,
  type MetadataVariant,
  type StudioProject,
  type StudioResource,
  type StudioResourceKind,
} from "./studioProjects.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
// Finished (or failed/cancelled) exports are kept this long for download before they're deleted —
// long enough to come back to the next day, since they now survive a service restart.
const MAX_JOB_AGE_MS = Number(process.env.RENDER_KEEP_HOURS || 24) * 60 * 60 * 1000;
// An upload folder with no job in it is only deleted once it's clearly not a request in progress.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

// The whole HTTP API, not yet listening — index.ts binds it to a port, tests bind it to port 0.
export const app: Express = express();

app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

function paramString(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

// --- Exports: one upload, any number of outputs (sizes/formats), each a job in a queue that
// survives page reloads (the editor re-reads it from here) and service restarts (jobStore.ts).

const MAX_OUTPUTS_PER_REQUEST = 12;
const MAX_OUTPUT_EDGE = 7680;

function assignBatchId(req: Request, res: Response, next: NextFunction) {
  const batchId = randomUUID();
  req.batchId = batchId;
  // Until startRenderBatch has turned these files into jobs, nothing else will ever delete them.
  onUploadAbandoned(req, res, () => {
    removeBatchDir(batchId).catch(() => {});
  });
  next();
}

// Uploaded media is stored as `<sourceId>.<ext>`, both taken from the request — so both are held
// to a strict shape before they can become part of a path. Source ids are UUIDs the editor mints;
// anything else (a "../" in particular) is refused, with a 400 rather than a file written
// somewhere it shouldn't be.
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EXTENSION_PATTERN = /^\.[A-Za-z0-9]{1,12}$/;

function sourceIdOfField(fieldname: string): string {
  return fieldname.replace(/^media_/, "");
}

function mediaFileName(file: Express.Multer.File): string {
  const ext = path.extname(file.originalname);
  return `${sourceIdOfField(file.fieldname)}${EXTENSION_PATTERN.test(ext) ? ext : ""}`;
}

function rejectUnsafeMediaFields(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (SOURCE_ID_PATTERN.test(sourceIdOfField(file.fieldname))) {
    cb(null, true);
    return;
  }
  const err = new Error(`Invalid media field name "${file.fieldname}"`) as Error & { status: number };
  err.status = 400;
  cb(err);
}

const renderStorage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const dir = batchMediaDir(req.batchId ?? "unknown");
    mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch((err) => cb(err as Error, dir));
  },
  filename: (_req, file, cb) => cb(null, mediaFileName(file)),
});
const renderUpload = multer({ storage: renderStorage, fileFilter: rejectUnsafeMediaFields });

function roundEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

// Either `outputs` (a JSON array of { width, height, format?, label? }) or the original single
// width/height(/format) fields. Returns a message instead of a list when the request makes no sense.
function parseOutputs(body: Record<string, unknown>, canvas: { width: number; height: number }): RenderOutputRequest[] | string {
  let raw: unknown[];
  if (typeof body.outputs === "string" && body.outputs.trim()) {
    try {
      const parsed: unknown = JSON.parse(body.outputs);
      if (!Array.isArray(parsed)) return "outputs must be a JSON array";
      raw = parsed;
    } catch {
      return "outputs must be a JSON array";
    }
  } else {
    raw = [{ width: body.width, height: body.height, format: body.format, label: body.label }];
  }
  if (raw.length === 0) return "Pick at least one output to export";
  if (raw.length > MAX_OUTPUTS_PER_REQUEST) return `At most ${MAX_OUTPUTS_PER_REQUEST} outputs per export`;

  const outputs: RenderOutputRequest[] = [];
  for (const entry of raw) {
    const spec = (entry ?? {}) as Record<string, unknown>;
    const width = Number(spec.width);
    const height = Number(spec.height);
    const hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    // No size at all means "the project canvas"; a size that's there but wrong is an error.
    const given = (value: unknown) => value !== undefined && value !== null && value !== "";
    if ((given(spec.width) || given(spec.height)) && !hasSize) return "Each output needs a positive width and height";
    if (hasSize && (width > MAX_OUTPUT_EDGE || height > MAX_OUTPUT_EDGE)) {
      return `Output size can't exceed ${MAX_OUTPUT_EDGE}px on either side`;
    }
    const format = spec.format === undefined || spec.format === "" ? DEFAULT_OUTPUT_FORMAT : spec.format;
    if (!isOutputFormatId(format)) return `Unknown output format "${String(spec.format)}"`;
    outputs.push({
      width: hasSize ? roundEven(width) : canvas.width,
      height: hasSize ? roundEven(height) : canvas.height,
      format,
      label: typeof spec.label === "string" ? spec.label.slice(0, 60) : null,
    });
  }
  return outputs;
}

function parseMediaRefs(raw: unknown): Record<string, string> | string {
  if (raw === undefined || raw === "") return {};
  if (typeof raw !== "string") return "mediaRefs must be a JSON object";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "mediaRefs must be a JSON object";
    const refs: Record<string, string> = {};
    for (const [sourceId, fingerprint] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof fingerprint !== "string") return "mediaRefs must map source ids to fingerprints";
      refs[sourceId] = fingerprint;
    }
    return refs;
  } catch {
    return "mediaRefs must be a JSON object";
  }
}

app.post("/render", assignBatchId, renderUpload.any(), async (req: Request, res: Response) => {
  const batchId = req.batchId as string;

  let project: ProjectModel;
  try {
    project = JSON.parse(req.body.project);
    if (!project || typeof project !== "object" || !project.canvas) throw new Error("not a project");
  } catch {
    res.status(400).json({ error: "Invalid or missing project JSON" });
    return;
  }

  const outputs = parseOutputs(req.body, project.canvas);
  if (typeof outputs === "string") {
    res.status(400).json({ error: outputs });
    return;
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const sourcePaths: Record<string, string> = {};
  for (const file of files) {
    sourcePaths[sourceIdOfField(file.fieldname)] = file.path;
  }

  // Files the editor didn't send because the saved project already has them: `mediaRefs` maps a
  // source id to the fingerprint the editor computed, and each is copied from the project's own
  // folder into this batch — after checking it really is the same file — so the batch stays
  // self-contained whatever happens to the project later. Anything that doesn't check out is
  // reported back, and the editor sends those files the old way.
  const refs = parseMediaRefs(req.body.mediaRefs);
  if (typeof refs === "string") {
    res.status(400).json({ error: refs });
    return;
  }
  const missingSourceIds: string[] = [];
  for (const [sourceId, fingerprint] of Object.entries(refs)) {
    if (sourcePaths[sourceId]) continue;
    const filePath = isValidProjectId(project.id) ? await findMediaFilePath(project.id, sourceId) : null;
    if (!filePath || (await fingerprintFile(filePath).catch(() => null))?.fingerprint !== fingerprint) {
      missingSourceIds.push(sourceId);
      continue;
    }
    const target = path.join(batchMediaDir(batchId), path.basename(filePath));
    try {
      await mkdir(batchMediaDir(batchId), { recursive: true });
      // A reflink where the file system offers one (APFS, Btrfs, XFS), a plain copy elsewhere.
      await copyFile(filePath, target, fsConstants.COPYFILE_FICLONE);
      sourcePaths[sourceId] = target;
    } catch {
      missingSourceIds.push(sourceId);
    }
  }
  if (missingSourceIds.length > 0) {
    res.status(409).json({
      error: "Some media isn't on the service as the editor expected — it needs to be uploaded with the export.",
      missingSourceIds,
    });
    return;
  }

  let jobs: Job[];
  try {
    jobs = await startRenderBatch(batchId, project, sourcePaths, outputs);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  commitUpload(req);
  res.status(202).json({
    batchId,
    jobId: jobs[0].id, // the first output, for clients that only ever asked for one
    jobIds: jobs.map((job) => job.id),
    jobs: jobs.map(toJobSummary),
  });
});

app.get("/render", (req: Request, res: Response) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json(listJobs({ projectId }).map(toJobSummary));
});

function openEventStream(res: Response): (payload: unknown) => void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  return (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
}

// Every job's every change on one connection, so the editor can follow a whole batch (and
// anything started before a reload) without opening a stream per job. Starts with a snapshot.
app.get("/render/events", (req: Request, res: Response) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const send = openEventStream(res);
  send({ type: "snapshot", jobs: listJobs({ projectId }).map(toJobSummary) });

  function onUpdate(job: Job, event: JobEvent) {
    if (projectId && job.projectId !== projectId) return;
    send({ type: "job", job: toJobSummary(job), event });
  }
  function onRemoved(job: Job) {
    if (projectId && job.projectId !== projectId) return;
    send({ type: "removed", jobId: job.id });
  }
  jobEvents.on("update", onUpdate);
  jobEvents.on("removed", onRemoved);
  // A comment line every so often keeps proxies and the browser from timing the stream out.
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    jobEvents.off("update", onUpdate);
    jobEvents.off("removed", onRemoved);
  });
});

app.get("/render/:jobId", (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Unknown export" });
    return;
  }
  res.json(toJobSummary(job));
});

app.get("/render/:jobId/events", (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job) {
    res.status(404).end();
    return;
  }

  const send = openEventStream(res);

  if (job.status === "queued") send({ type: "queued", position: job.queuePosition ?? 0 } satisfies JobEvent);
  send({ type: "progress", percent: job.percent });
  if (job.status === "done" && job.outputPath) {
    send({
      type: "done",
      outputPath: job.outputPath,
      downloadName: job.downloadName,
      outputBytes: job.outputBytes,
      warning: job.warning,
    } satisfies JobEvent);
  }
  if (job.status === "error" && job.errorMessage) send({ type: "error", message: job.errorMessage });
  if (job.status === "cancelled") send({ type: "cancelled" });

  if (!isJobActive(job)) {
    res.end();
    return;
  }

  function onUpdate(event: JobEvent) {
    send(event);
  }
  job.emitter.on("update", onUpdate);

  req.on("close", () => {
    job.emitter.off("update", onUpdate);
  });
});

app.get("/render/:jobId/result", (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job || job.status !== "done" || !job.outputPath) {
    res.status(404).end();
    return;
  }
  res.download(job.outputPath, job.downloadName);
});

app.post("/render/:jobId/cancel", (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job) {
    res.status(404).end();
    return;
  }
  cancelJob(job);
  res.json({ status: job.status });
});

// Moves a waiting export in the line: { direction: "front" | "up" | "down" | "back" }.
app.post("/render/:jobId/move", (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Unknown export" });
    return;
  }
  const direction = (req.body as { direction?: unknown } | undefined)?.direction;
  if (direction !== "front" && direction !== "up" && direction !== "down" && direction !== "back") {
    res.status(400).json({ error: 'direction must be "front", "up", "down" or "back"' });
    return;
  }
  if (!getRenderQueue().move(job, direction)) {
    res.status(409).json({ error: "Only an export that is still waiting in line can be moved." });
    return;
  }
  res.json({ job: toJobSummary(job), line: getRenderQueue().line.map(toJobSummary) });
});

// Runs a failed/cancelled export again with the same settings; answers with the replacement job.
app.post("/render/:jobId/retry", async (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Unknown export" });
    return;
  }
  try {
    const replacement = await retryJob(job);
    res.status(202).json(toJobSummary(replacement));
  } catch (err) {
    const status = err instanceof RetryUnavailableError ? 409 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Forgets a job and deletes everything it had on disk (cancelling it first if it's still going).
app.delete("/render/:jobId", (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job) {
    res.status(404).end();
    return;
  }
  removeJob(job);
  res.json({ status: "deleted" });
});

// Standalone Audio Editor: one synchronous ffmpeg pass (trim + fade + gain + speed) → encoded file.
app.post("/audio/edit", audioEditUpload, handleAudioEdit);

installJobPersistence();

// Picks up where the last run left off: finished exports stay downloadable, unfinished ones render
// again. The promise is exported so tests (and index.ts) can wait for it before relying on the list.
export const jobsRestored: Promise<void> = loadPersistedJobs()
  .then((toResume) => {
    for (const job of toResume) enqueueJob(job);
    if (toResume.length > 0) console.log(`Resuming ${toResume.length} export(s) from before the restart`);
    return sweepOrphanDirs(0).then((removed) => {
      if (removed.length > 0) console.log(`Removed ${removed.length} abandoned export folder(s)`);
    });
  })
  .then(() => Promise.all(listJobs().map((job) => removeBatchMediaIfIdle(job.batchId))).then(() => undefined))
  // Earlier versions kept exports under the OS temp dir and forgot them on restart; whatever is
  // still there is from one of those runs and nothing will ever ask for it again.
  .then(() => rm(path.join(os.tmpdir(), "reel-studio-render"), { recursive: true, force: true }))
  .catch((err) => console.error("Couldn't restore exports from disk:", err));

// unref: a periodic sweep must never be the only thing keeping the process (or a test run) alive.
setInterval(() => {
  sweepOldJobs(MAX_JOB_AGE_MS, () => {
    // The "removed" event (see installJobPersistence) deletes the job's files.
  });
  sweepOrphanDirs(ORPHAN_MIN_AGE_MS).catch(() => {});
}, SWEEP_INTERVAL_MS).unref();

// --- Project persistence: each project lives at ~/ReelStudioProjects/<id>/, with its
// media files alongside project.json, so it's a self-contained folder the user can see,
// back up, or move like any other folder on disk.

const projectStorage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const projectId = paramString(req.params.projectId);
    if (!isValidProjectId(projectId)) {
      cb(new Error("Invalid project id"), "");
      return;
    }
    const dir = mediaDir(projectId);
    mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch((err) => cb(err as Error, dir));
  },
  filename: (_req, file, cb) => cb(null, mediaFileName(file)),
});
const projectUpload = multer({ storage: projectStorage, fileFilter: rejectUnsafeMediaFields });

function requireValidProjectId(req: Request, res: Response, next: NextFunction) {
  if (!isValidProjectId(paramString(req.params.projectId))) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  next();
}

app.get("/projects", async (_req: Request, res: Response) => {
  try {
    res.json(await listProjects());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Media files go straight into the project's own folder, so a request that then turns out to be
// bad (or one the browser abandons mid-upload) must take its files back out again — otherwise a
// project that was never saved still grows a media folder, and a real project keeps every file
// ever uploaded to it.
function guardProjectUpload(req: Request, res: Response, next: NextFunction) {
  const projectId = paramString(req.params.projectId);
  onUploadAbandoned(req, res, () => {
    const uploaded = ((req.files as Express.Multer.File[] | undefined) ?? []).map((file) => file.path);
    discardProjectUpload(projectId, uploaded).catch(() => {});
  });
  next();
}

app.post("/projects/:projectId", requireValidProjectId, guardProjectUpload, projectUpload.any(), async (req: Request, res: Response) => {
  const projectId = paramString(req.params.projectId);
  let project: ProjectModel;
  try {
    project = JSON.parse(req.body.project);
    if (!project || typeof project !== "object" || !Array.isArray(project.sources)) throw new Error("not a project");
  } catch {
    res.status(400).json({ error: "Invalid or missing project JSON" });
    return;
  }

  try {
    await saveProjectFile(projectId, project);
    commitUpload(req);
    // A source that was removed from the project (or replaced) leaves its old file behind otherwise.
    await pruneUnreferencedMedia(projectId, project);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  res.json({ status: "ok" });
});

app.get("/projects/:projectId", requireValidProjectId, async (req: Request, res: Response) => {
  try {
    res.json(await readProjectFile(paramString(req.params.projectId)));
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

// What the project already has on disk, so the editor uploads only what's new or changed.
app.get("/projects/:projectId/media", requireValidProjectId, async (req: Request, res: Response) => {
  res.json(await listProjectMedia(paramString(req.params.projectId)));
});

app.get("/projects/:projectId/media/:sourceId", requireValidProjectId, async (req: Request, res: Response) => {
  const filePath = await findMediaFilePath(paramString(req.params.projectId), paramString(req.params.sourceId));
  if (!filePath) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

app.delete("/projects/:projectId", requireValidProjectId, async (req: Request, res: Response) => {
  try {
    await deleteProjectDir(paramString(req.params.projectId));
    res.json({ status: "deleted" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Studio projects: the "one folder holds everything" home for a Prompt/Rhyme Studio project —
// its poem, master/scene prompts, and every resource (cover, logo, banner, character ref,
// generated scene clip/audio, final export) it owns. The language-specific editor timelines it
// launches live as ordinary entries under PROJECTS_ROOT (see projects.ts) so the existing
// Dashboard/Editor already knows how to open, edit, and re-save them — this project just tracks
// which ones belong to it, so nothing about a video/audio file is ever stored twice.

function requireValidStudioId(req: Request, res: Response, next: NextFunction) {
  if (!isValidStudioId(paramString(req.params.studioId))) {
    res.status(400).json({ error: "Invalid studio project id" });
    return;
  }
  next();
}

app.get("/studio", async (_req: Request, res: Response) => {
  try {
    res.json(await listStudioProjects());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/studio", async (req: Request, res: Response) => {
  const id = randomUUID();
  const now = Date.now();
  const body = req.body ?? {};
  const videoType = body.videoType === "reel" ? "reel" : "full_video";
  const project: StudioProject = {
    id,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled project",
    createdAt: now,
    updatedAt: now,
    languages: Array.isArray(body.languages) && body.languages.length ? body.languages : ["English"],
    poem: {},
    videoType,
    aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : videoType === "reel" ? "9:16" : "16:9",
    platform: body.platform,
    style: body.style,
    model: typeof body.model === "string" ? body.model : "Veo 3.1 Lite",
    creditsPerClip: typeof body.creditsPerClip === "number" ? body.creditsPerClip : 10,
    creditsPerAccount: typeof body.creditsPerAccount === "number" ? body.creditsPerAccount : 50,
    masterPrompt: "",
    totalLengthSeconds: typeof body.totalLengthSeconds === "number" ? body.totalLengthSeconds : 32,
    clipLengthSeconds: typeof body.clipLengthSeconds === "number" ? body.clipLengthSeconds : 8,
    accounts: [],
    scenes: [],
    resources: [],
    editorProjects: [],
    metadata: [],
  };
  try {
    await saveStudioProjectFile(id, project);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/studio/:studioId", requireValidStudioId, async (req: Request, res: Response) => {
  try {
    res.json(await readStudioProjectFile(paramString(req.params.studioId)));
  } catch {
    res.status(404).json({ error: "Studio project not found" });
  }
});

app.patch("/studio/:studioId", requireValidStudioId, async (req: Request, res: Response) => {
  const studioId = paramString(req.params.studioId);
  try {
    const existing = await readStudioProjectFile(studioId);
    const patch = (req.body ?? {}) as Partial<StudioProject>;
    const updated: StudioProject = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
    await saveStudioProjectFile(studioId, updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// One title/description/hashtag set per language a project targets. Not a translation of any
// other language's version, just the same subject asked for fresh in that language.
app.post("/studio/:studioId/metadata", requireValidStudioId, async (req: Request, res: Response) => {
  const studioId = paramString(req.params.studioId);
  const body = req.body as { language?: string; topic?: string; title?: string };
  if (!body.language || typeof body.language !== "string") {
    res.status(400).json({ error: "language is required" });
    return;
  }
  try {
    const project = await readStudioProjectFile(studioId);
    const title = body.title || project.title;
    const topic = body.topic || project.concept || project.title;
    const result = await generateSocialMetadata({ title, topic, language: body.language });
    const variant = {
      label: body.language,
      language: body.language,
      title: result.title,
      description: result.description,
      hashtags: result.hashtags,
    };
    project.metadata = [...project.metadata.filter((m) => m.language !== body.language), variant];
    project.updatedAt = Date.now();
    await saveStudioProjectFile(studioId, project);
    res.json(project);
  } catch (err) {
    console.error("Metadata generation failed:", err);
    res.status(502).json({ error: "Metadata generation failed, please try again." });
  }
});

app.delete("/studio/:studioId", requireValidStudioId, async (req: Request, res: Response) => {
  try {
    await deleteStudioDir(paramString(req.params.studioId));
    res.json({ status: "deleted" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

function assignResourceId(req: Request, _res: Response, next: NextFunction) {
  req.resourceId = randomUUID();
  next();
}

const studioResourceStorage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const studioId = paramString(req.params.studioId);
    if (!isValidStudioId(studioId)) {
      cb(new Error("Invalid studio project id"), "");
      return;
    }
    const dir = studioResourcesDir(studioId);
    mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch((err) => cb(err as Error, dir));
  },
  filename: (req: Request, file, cb) => {
    cb(null, `${req.resourceId}${path.extname(file.originalname) || ""}`);
  },
});
const studioResourceUpload = multer({ storage: studioResourceStorage });

// Same deal as project media: the file is on disk before we know whether the studio project even
// exists, so anything short of "recorded in studio.json" deletes it again.
function guardStudioResourceUpload(req: Request, res: Response, next: NextFunction) {
  onUploadAbandoned(req, res, () => {
    if (req.file?.path) rm(req.file.path, { force: true }).catch(() => {});
  });
  next();
}

app.post(
  "/studio/:studioId/resources",
  requireValidStudioId,
  assignResourceId,
  guardStudioResourceUpload,
  studioResourceUpload.single("file"),
  async (req: Request, res: Response) => {
    const studioId = paramString(req.params.studioId);
    if (!req.file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    try {
      const project = await readStudioProjectFile(studioId);
      const sceneNRaw = req.body.sceneN;
      const sceneN = sceneNRaw !== undefined && sceneNRaw !== "" ? Number(sceneNRaw) : null;
      const resource: StudioResource = {
        id: req.resourceId as string,
        kind: (paramString(req.body.kind ?? "other") as StudioResourceKind) || "other",
        language: req.body.language ? paramString(req.body.language) : null,
        sceneN: sceneN !== null && Number.isFinite(sceneN) ? sceneN : null,
        filename: req.file.filename,
        metadata: [],
        uploadedAt: Date.now(),
      };
      project.resources.push(resource);
      project.updatedAt = Date.now();
      await saveStudioProjectFile(studioId, project);
      commitUpload(req);
      res.status(201).json(resource);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

app.get("/studio/:studioId/resources/:resourceId", requireValidStudioId, async (req: Request, res: Response) => {
  const filePath = await findStudioResourceFilePath(paramString(req.params.studioId), paramString(req.params.resourceId));
  if (!filePath) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

app.patch("/studio/:studioId/resources/:resourceId", requireValidStudioId, async (req: Request, res: Response) => {
  const studioId = paramString(req.params.studioId);
  const resourceId = paramString(req.params.resourceId);
  try {
    const project = await readStudioProjectFile(studioId);
    const resource = project.resources.find((r) => r.id === resourceId);
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    const patch = (req.body ?? {}) as Partial<StudioResource> & { metadata?: MetadataVariant[] };
    if (Array.isArray(patch.metadata)) resource.metadata = patch.metadata;
    if (patch.kind) resource.kind = patch.kind;
    if ("language" in patch) resource.language = patch.language ?? null;
    if ("sceneN" in patch) resource.sceneN = patch.sceneN ?? null;
    project.updatedAt = Date.now();
    await saveStudioProjectFile(studioId, project);
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/studio/:studioId/resources/:resourceId", requireValidStudioId, async (req: Request, res: Response) => {
  const studioId = paramString(req.params.studioId);
  const resourceId = paramString(req.params.resourceId);
  try {
    const project = await readStudioProjectFile(studioId);
    project.resources = project.resources.filter((r) => r.id !== resourceId);
    project.updatedAt = Date.now();
    await saveStudioProjectFile(studioId, project);
    // The file itself, too — a resource nothing lists any more is just disk space.
    const filePath = await findStudioResourceFilePath(studioId, resourceId);
    if (filePath) await rm(filePath, { force: true });
    res.json({ status: "deleted" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Generation is one way to fill in a Studio project's poem/prompts — pasting them in by hand from
// any chat UI works exactly as well, so this route is a convenience, never a required step.
app.post("/studio/:studioId/generate", requireValidStudioId, async (req: Request, res: Response) => {
  const studioId = paramString(req.params.studioId);
  const params = req.body as GenerateParams;

  // Validate before writing any SSE headers, so a bad model/videoType is a normal 400 JSON
  // response instead of a 200 stream carrying only an `error` event.
  try {
    aspectAndFormat(params.videoType);
    creditsPerClipForModel(params.model);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!params.topic || typeof params.topic !== "string") {
    res.status(400).json({ error: "Missing topic" });
    return;
  }
  if (!Number.isInteger(params.numScenes) || params.numScenes < 1 || params.numScenes > 30) {
    res.status(400).json({ error: "numScenes must be an integer between 1 and 30" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    for await (const event of generateStudioProject(params)) {
      send(event.type, event.data);
      if (event.type === "done") {
        try {
          const project = await readStudioProjectFile(studioId);
          project.concept = event.data.base.concept;
          project.hook = event.data.base.hook;
          project.masterPrompt = event.data.base.master_prompt;
          project.caption = event.data.base.caption;
          project.hashtags = event.data.base.hashtags;
          project.scenes = event.data.scenes;
          project.accounts = event.data.accounts;
          project.namingConvention = `scene_01 to scene_${String(params.numScenes).padStart(2, "0")}`;
          project.updatedAt = Date.now();
          await saveStudioProjectFile(studioId, project);
        } catch (err) {
          send("error", { message: `Generated, but failed to save: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
  } catch (err) {
    send("error", { message: err instanceof Error ? err.message : String(err) });
  }
  res.end();
});

app.use("/rhyme", createRhymeRouter());

// Last: turns anything thrown/forwarded by a route or middleware (multer included) into JSON.
app.use(jsonErrorHandler);
