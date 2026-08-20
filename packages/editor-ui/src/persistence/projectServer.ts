import type { ProjectModel } from "@reel-studio/shared-types";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { RENDER_SERVICE_URL } from "../constants.js";
import { getUsedSourceIds } from "../media/usedSources.js";
import { generateImageThumbnail, generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";
import { loadMediaBlob, saveMediaBlob } from "./db.js";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  clipCount: number;
  overlayCount: number;
  thumbnailDataUrl: string | null;
  isTemplate: boolean;
}

export async function listProjectsFromServer(): Promise<ProjectSummary[]> {
  const response = await fetch(`${RENDER_SERVICE_URL}/projects`);
  if (!response.ok) throw new Error("Failed to list saved projects");
  return response.json();
}

async function computeProjectThumbnail(project: ProjectModel): Promise<string | null> {
  const videoTrackId = project.tracks.find((t) => t.kind === "video")?.id;
  if (!videoTrackId) return null;
  const laidOut = layoutSequentialClips(project.clips.filter((c) => c.trackId === videoTrackId));
  const firstClip = laidOut[0];
  if (!firstClip) return null;
  const source = project.sources.find((s) => s.id === firstClip.sourceId);
  if (!source || !source.previewUrl) return null;

  try {
    if (source.kind === "image") return await generateImageThumbnail(source.previewUrl);
    const frames = await generateVideoThumbnails(source.previewUrl, firstClip.inPoint, firstClip.outPoint, 1);
    return frames[0] ?? null;
  } catch {
    return null;
  }
}

// Turns a finished project into a reusable template: keeps the arrangement (clips, timing, titles,
// filters, transitions) but replaces every source with a placeholder that has no real file, so the
// template saves and loads with zero media, and the person swaps in their own footage per clip
// (via each clip's existing "Replace media" control) once they start from it.
export function stripProjectToTemplate(project: ProjectModel, name: string): ProjectModel {
  return {
    ...project,
    id: crypto.randomUUID(),
    sources: project.sources.map((s) => ({ ...s, filePath: "", previewUrl: "", isPlaceholder: true })),
    metadata: {
      ...project.metadata,
      name,
      isTemplate: true,
      templateId: null,
      thumbnailDataUrl: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

export async function saveProjectToServer(project: ProjectModel): Promise<void> {
  const thumbnailDataUrl = await computeProjectThumbnail(project);
  const projectToSave: ProjectModel = { ...project, metadata: { ...project.metadata, thumbnailDataUrl } };

  const usedSourceIds = getUsedSourceIds(project);
  const formData = new FormData();
  formData.append("project", JSON.stringify(projectToSave));

  for (const sourceId of usedSourceIds) {
    const blob = await loadMediaBlob(sourceId);
    if (!blob) continue;
    formData.append(`media_${sourceId}`, blob, sourceId);
  }

  const response = await fetch(`${RENDER_SERVICE_URL}/projects/${project.id}`, { method: "POST", body: formData });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Save failed" }));
    throw new Error(body.error ?? "Save failed");
  }
}

export async function loadProjectFromServer(projectId: string): Promise<ProjectModel> {
  const response = await fetch(`${RENDER_SERVICE_URL}/projects/${projectId}`);
  if (!response.ok) throw new Error("Project not found");
  const project: ProjectModel = await response.json();

  const hydratedSources = await Promise.all(
    project.sources.map(async (source) => {
      // A placeholder has no file at all, and a `origin`-tagged source's previewUrl already points
      // straight at its Studio project's resource URL — it was never uploaded into *this* project's
      // own media folder (that's the point: one shared copy, not one per project), so there is
      // nothing to fetch from this project's `/media/:sourceId` endpoint for either case.
      if (source.isPlaceholder || source.origin) return source;
      try {
        const mediaResponse = await fetch(`${RENDER_SERVICE_URL}/projects/${projectId}/media/${source.id}`);
        if (!mediaResponse.ok) throw new Error("missing media");
        const blob = await mediaResponse.blob();
        await saveMediaBlob(source.id, blob);
        return { ...source, previewUrl: URL.createObjectURL(blob) };
      } catch {
        console.warn(`Missing stored media for "${source.name}" — re-import it to restore this clip.`);
        return { ...source, previewUrl: "" };
      }
    })
  );

  return { ...project, sources: hydratedSources };
}

export async function deleteProjectFromServer(projectId: string): Promise<void> {
  const response = await fetch(`${RENDER_SERVICE_URL}/projects/${projectId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete project");
}
