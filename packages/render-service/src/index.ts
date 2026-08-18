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

const PORT = process.env.PORT ? Number(process.env.PORT) : 4310;
const TMP_ROOT = path.join(os.tmpdir(), "reel-studio-render");
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_JOB_AGE_MS = 60 * 60 * 1000;

const app = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
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

  try {
    startRenderJob(jobId, project, sourcePaths, workDir);
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

app.listen(PORT, () => {
  console.log(`render-service listening on http://localhost:${PORT}`);
});
