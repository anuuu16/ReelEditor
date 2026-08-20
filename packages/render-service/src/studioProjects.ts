import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECTS_ROOT, isValidProjectId } from "./projects.js";

// Studio projects live in their own subfolder of the same ~/ReelStudioProjects root render-service
// already uses for editor projects — `_studio` can never collide with a real (UUID) project id, so
// the existing /projects listing keeps ignoring it for free. Everything a Studio project owns (the
// poem, the master/scene prompts, and every uploaded or generated asset) lives inside its own
// folder here; the language-specific editor timelines it launches are separate, ordinary entries
// under PROJECTS_ROOT (so the existing Dashboard/Editor already knows how to open them), and this
// project just remembers their ids.

export const STUDIO_ROOT = path.join(PROJECTS_ROOT, "_studio");

export function isValidStudioId(id: string): boolean {
  return isValidProjectId(id);
}

export function studioDir(studioId: string): string {
  return path.join(STUDIO_ROOT, studioId);
}

export function studioResourcesDir(studioId: string): string {
  return path.join(studioDir(studioId), "resources");
}

export type StudioResourceKind =
  | "cover"
  | "logo"
  | "banner"
  | "character"
  | "sceneVideo"
  | "sceneAudio"
  | "finalExport"
  | "other";

export interface MetadataVariant {
  label?: string;
  language?: string;
  title?: string;
  description?: string;
  hashtags?: string[];
}

export interface StudioResource {
  id: string;
  kind: StudioResourceKind;
  language: string | null;
  sceneN: number | null;
  filename: string;
  metadata: MetadataVariant[];
  uploadedAt: number;
}

export interface StudioScene {
  n: number;
  clipName: string;
  account: number;
  section?: string;
  title?: string;
  timeStart?: string;
  timeEnd?: string;
  durationSeconds: number;
  shot?: string;
  audio?: string;
  prompt: string;
}

export interface StudioAccountGroup {
  account: number;
  sceneRange: [number, number];
  clips: number;
  credits: number;
}

export interface StudioEditorProjectLink {
  language: string;
  editorProjectId: string;
  label?: string;
}

export interface StudioProject {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  languages: string[];
  /** Poem/lyrics text, keyed by language code — filled in by generation, by pasting, or both. */
  poem: Record<string, string>;
  videoType: "reel" | "full_video";
  aspectRatio: string;
  platform?: string;
  style?: string;
  model: string;
  creditsPerClip: number;
  creditsPerAccount: number;
  namingConvention?: string;
  concept?: string;
  hook?: string;
  masterPrompt: string;
  caption?: string;
  hashtags?: string[];
  accounts: StudioAccountGroup[];
  scenes: StudioScene[];
  resources: StudioResource[];
  editorProjects: StudioEditorProjectLink[];
  metadata: MetadataVariant[];
}

export interface StudioProjectSummary {
  id: string;
  title: string;
  updatedAt: number;
  languages: string[];
  sceneCount: number;
  resourceCount: number;
  editorProjectCount: number;
}

function studioFilePath(studioId: string): string {
  return path.join(studioDir(studioId), "studio.json");
}

export async function saveStudioProjectFile(studioId: string, project: StudioProject): Promise<void> {
  await mkdir(studioDir(studioId), { recursive: true });
  await writeFile(studioFilePath(studioId), JSON.stringify(project, null, 2), "utf8");
}

export async function readStudioProjectFile(studioId: string): Promise<StudioProject> {
  const raw = await readFile(studioFilePath(studioId), "utf8");
  return JSON.parse(raw) as StudioProject;
}

export async function listStudioProjects(): Promise<StudioProjectSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(STUDIO_ROOT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const summaries: StudioProjectSummary[] = [];
  for (const id of entries) {
    if (!isValidStudioId(id)) continue;
    try {
      const project = await readStudioProjectFile(id);
      summaries.push({
        id,
        title: project.title,
        updatedAt: project.updatedAt,
        languages: project.languages,
        sceneCount: project.scenes.length,
        resourceCount: project.resources.length,
        editorProjectCount: project.editorProjects.length,
      });
    } catch {
      // Skip a studio directory whose studio.json is missing or unreadable.
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteStudioDir(studioId: string): Promise<void> {
  await rm(studioDir(studioId), { recursive: true, force: true });
}

export async function findStudioResourceFilePath(studioId: string, resourceId: string): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(studioResourcesDir(studioId));
  } catch {
    return null;
  }
  const match = files.find((f) => f === resourceId || f.startsWith(`${resourceId}.`));
  return match ? path.join(studioResourcesDir(studioId), match) : null;
}
