import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectModel } from "@reel-studio/shared-types";

export const PROJECTS_ROOT = path.join(os.homedir(), "ReelStudioProjects");

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
