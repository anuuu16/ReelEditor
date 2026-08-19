import type { ProjectModel } from "@reel-studio/shared-types";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { RENDER_SERVICE_URL } from "../constants.js";
import { getUsedSourceIds } from "../media/usedSources.js";
import { generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";
import { loadMediaBlob, saveMediaBlob } from "./db.js";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  clipCount: number;
  overlayCount: number;
  thumbnailDataUrl: string | null;
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
    const frames = await generateVideoThumbnails(source.previewUrl, firstClip.inPoint, firstClip.outPoint, 1);
    return frames[0] ?? null;
  } catch {
    return null;
  }
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
