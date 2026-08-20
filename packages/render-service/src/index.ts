import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { ProjectModel } from "@reel-studio/shared-types";
import { cancelJob, getJob, sweepOldJobs, type JobEvent } from "./jobs.js";
import {
  deleteProjectDir,
  findMediaFilePath,
  isValidProjectId,
  listProjects,
  mediaDir,
  readProjectFile,
  saveProjectFile,
} from "./projects.js";
import { startRenderJob } from "./render.js";
import { createRhymeRouter } from "./rhymeRoutes.js";
import { aspectAndFormat, creditsPerClipForModel, generateStudioProject, type GenerateParams } from "./studioGenerate.js";
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

try {
  // Only /studio/:id/generate needs ANTHROPIC_API_KEY — everything else works with no .env at all.
  process.loadEnvFile();
} catch {
  // No .env file, or an old Node without loadEnvFile — fine, that endpoint just isn't usable yet.
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 4310;
const TMP_ROOT = path.join(os.tmpdir(), "reel-studio-render");
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_JOB_AGE_MS = 60 * 60 * 1000;

const app = express();

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

function assignJobId(req: Request, _res: Response, next: NextFunction) {
  req.jobId = randomUUID();
  next();
}

const renderStorage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const dir = path.join(TMP_ROOT, req.jobId ?? "unknown");
    mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch((err) => cb(err as Error, dir));
  },
  filename: (_req, file, cb) => {
    const sourceId = file.fieldname.replace(/^media_/, "");
    cb(null, `${sourceId}${path.extname(file.originalname) || ""}`);
  },
});
const renderUpload = multer({ storage: renderStorage });

app.post("/render", assignJobId, renderUpload.any(), (req: Request, res: Response) => {
  const jobId = req.jobId as string;
  const workDir = path.join(TMP_ROOT, jobId);

  let project: ProjectModel;
  try {
    project = JSON.parse(req.body.project);
  } catch {
    res.status(400).json({ error: "Invalid or missing project JSON" });
    return;
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const sourcePaths: Record<string, string> = {};
  for (const file of files) {
    sourcePaths[file.fieldname.replace(/^media_/, "")] = file.path;
  }

  const outputWidth = Number(req.body.width);
  const outputHeight = Number(req.body.height);
  const output =
    Number.isFinite(outputWidth) && Number.isFinite(outputHeight) && outputWidth > 0 && outputHeight > 0
      ? { width: outputWidth, height: outputHeight }
      : undefined;

  try {
    startRenderJob(jobId, project, sourcePaths, workDir, output);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  res.status(202).json({ jobId });
});

app.get("/render/:jobId/events", (req: Request, res: Response) => {
  const job = getJob(paramString(req.params.jobId));
  if (!job) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  function send(event: JobEvent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  send({ type: "progress", percent: job.percent });
  if (job.status === "done" && job.outputPath) send({ type: "done", outputPath: job.outputPath });
  if (job.status === "error" && job.errorMessage) send({ type: "error", message: job.errorMessage });
  if (job.status === "cancelled") send({ type: "cancelled" });

  if (job.status !== "running") {
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
  res.download(job.outputPath, "reel.mp4");
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

setInterval(() => {
  sweepOldJobs(MAX_JOB_AGE_MS, (job) => {
    rm(job.workDir, { recursive: true, force: true }).catch(() => {});
  });
}, SWEEP_INTERVAL_MS);

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
  filename: (_req, file, cb) => {
    const sourceId = file.fieldname.replace(/^media_/, "");
    cb(null, `${sourceId}${path.extname(file.originalname) || ""}`);
  },
});
const projectUpload = multer({ storage: projectStorage });

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

app.post("/projects/:projectId", requireValidProjectId, projectUpload.any(), async (req: Request, res: Response) => {
  const projectId = paramString(req.params.projectId);
  let project: ProjectModel;
  try {
    project = JSON.parse(req.body.project);
  } catch {
    res.status(400).json({ error: "Invalid or missing project JSON" });
    return;
  }

  try {
    await saveProjectFile(projectId, project);
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
    languages: Array.isArray(body.languages) && body.languages.length ? body.languages : ["en"],
    poem: {},
    videoType,
    aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : videoType === "reel" ? "9:16" : "16:9",
    platform: body.platform,
    style: body.style,
    model: typeof body.model === "string" ? body.model : "Veo 3.1 Lite",
    creditsPerClip: typeof body.creditsPerClip === "number" ? body.creditsPerClip : 10,
    creditsPerAccount: typeof body.creditsPerAccount === "number" ? body.creditsPerAccount : 50,
    masterPrompt: "",
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

app.post(
  "/studio/:studioId/resources",
  requireValidStudioId,
  assignResourceId,
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
      res.status(201).json(resource);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
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

app.listen(PORT, () => {
  console.log(`render-service listening on http://localhost:${PORT}`);
});
