import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectModel } from "@reel-studio/shared-types";

/** A path from .env, with a leading `~/` meaning the home directory the way a shell would take it. */
export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}

// REEL_PROJECTS_ROOT moves the whole projects folder (tests point it at a temp dir).
export const PROJECTS_ROOT = process.env.REEL_PROJECTS_ROOT
  ? expandHome(process.env.REEL_PROJECTS_ROOT)
  : path.join(os.homedir(), "ReelStudioProjects");

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProjectId(id: string): boolean {
  return PROJECT_ID_PATTERN.test(id);
}

export function projectDir(projectId: string): string {
  return path.join(PROJECTS_ROOT, projectId);
}

export function mediaDir(projectId: string): string {
  return path.join(projectDir(projectId), "media");
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  clipCount: number;
  overlayCount: number;
  thumbnailDataUrl: string | null;
  isTemplate: boolean;
}

export async function saveProjectFile(projectId: string, project: ProjectModel): Promise<void> {
  await mkdir(projectDir(projectId), { recursive: true });
  await writeFile(path.join(projectDir(projectId), "project.json"), JSON.stringify(project, null, 2), "utf8");
}

export async function readProjectFile(projectId: string): Promise<ProjectModel> {
  const raw = await readFile(path.join(projectDir(projectId), "project.json"), "utf8");
  return JSON.parse(raw) as ProjectModel;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(PROJECTS_ROOT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const summaries: ProjectSummary[] = [];
  for (const id of entries) {
    if (!isValidProjectId(id)) continue;
    try {
      const project = await readProjectFile(id);
      summaries.push({
        id,
        name: project.metadata.name,
        updatedAt: project.metadata.updatedAt,
        clipCount: project.clips.length,
        overlayCount: project.overlays.length,
        thumbnailDataUrl: project.metadata.thumbnailDataUrl,
        isTemplate: project.metadata.isTemplate ?? false,
      });
    } catch {
      // Skip a project directory whose project.json is missing or unreadable.
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProjectDir(projectId: string): Promise<void> {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

export async function findMediaFilePath(projectId: string, sourceId: string): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(mediaDir(projectId));
  } catch {
    return null;
  }
  const match = files.find((f) => f === sourceId || f.startsWith(`${sourceId}.`));
  return match ? path.join(mediaDir(projectId), match) : null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Files in a project's media folder that no source in the project refers to any more. */
export async function pruneUnreferencedMedia(projectId: string, project: ProjectModel): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(mediaDir(projectId));
  } catch {
    return [];
  }
  // Same rule findMediaFilePath uses to find a source's file: `<id>` or `<id>.<ext>`.
  const sourceIds = project.sources.map((s) => s.id);
  const removed: string[] = [];
  for (const file of files) {
    if (sourceIds.some((id) => file === id || file.startsWith(`${id}.`))) continue;
    await rm(path.join(mediaDir(projectId), file), { force: true });
    removed.push(file);
  }
  return removed;
}

/**
 * Undoes a save request's upload when the save itself never happened: the files it wrote go,
 * and if that leaves a folder with no project.json in it (a project that was never saved), the
 * folder goes too.
 */
export async function discardProjectUpload(projectId: string, uploadedPaths: string[]): Promise<void> {
  await Promise.all(uploadedPaths.map((filePath) => rm(filePath, { force: true })));
  if (await exists(path.join(projectDir(projectId), "project.json"))) {
    // A real project: only drop the media folder if the upload was the only thing in it.
    try {
      if ((await readdir(mediaDir(projectId))).length === 0) await rm(mediaDir(projectId), { recursive: true, force: true });
    } catch {
      // No media folder at all — nothing to tidy.
    }
    return;
  }
  await rm(projectDir(projectId), { recursive: true, force: true });
}
