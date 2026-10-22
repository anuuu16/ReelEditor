import type { ProjectModel } from "@reel-studio/shared-types";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { RENDER_SERVICE_URL } from "../constants.js";
import { fingerprintForSource } from "../media/mediaFingerprint.js";
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

export interface StoredMediaEntry {
  bytes: number;
  fingerprint: string;
}

/**
 * What the service already holds for a project, by source id. Empty when the project was never
 * saved — or the service can't be reached, in which case the caller's own request will say so.
 */
export async function listServerMedia(projectId: string): Promise<Record<string, StoredMediaEntry>> {
  try {
    const response = await fetch(`${RENDER_SERVICE_URL}/projects/${projectId}/media`);
    if (!response.ok) return {};
    return (await response.json()) as Record<string, StoredMediaEntry>;
  } catch {
    return {};
  }
}

export interface MediaUploadPlan {
  /** Sources whose file has to travel with the request. */
  upload: Array<{ sourceId: string; blob: Blob }>;
  /** Sources the service already has, by fingerprint — nothing to send. */
  refs: Record<string, string>;
  /** Sources with no stored file at all (a placeholder, a Studio resource, or lost media). */
  missing: string[];
}

/**
 * Decides, per used source, whether its file must be sent or the service already has that exact
 * file. Before this every save and every export re-uploaded every clip — the same gigabytes, over
 * and over — now only new or changed media goes over the wire.
 */
export async function planMediaUpload(
  project: ProjectModel,
  stored: Record<string, StoredMediaEntry>,
  forceUpload: ReadonlySet<string> = new Set(),
): Promise<MediaUploadPlan> {
  const plan: MediaUploadPlan = { upload: [], refs: {}, missing: [] };
  for (const sourceId of getUsedSourceIds(project)) {
    const blob = await loadMediaBlob(sourceId);
    if (!blob) {
      plan.missing.push(sourceId);
      continue;
    }
    const entry = stored[sourceId];
    if (entry && !forceUpload.has(sourceId) && entry.bytes === blob.size) {
      const fingerprint = await fingerprintForSource(sourceId, blob);
      if (fingerprint === entry.fingerprint) {
        plan.refs[sourceId] = fingerprint;
        continue;
      }
    }
    plan.upload.push({ sourceId, blob });
  }
  return plan;
}

export async function saveProjectToServer(project: ProjectModel): Promise<void> {
  const thumbnailDataUrl = await computeProjectThumbnail(project);
  // The reducer never stamps metadata.updatedAt on ordinary edits (it would mean touching every
  // action type), so this is the one place that actually knows "this snapshot was just persisted" —
  // otherwise the Dashboard/Projects panel keeps showing a stale creation-time date forever, which
  // reads as "my changes aren't saving" even when the file on disk is perfectly current.
  const projectToSave: ProjectModel = {
    ...project,
    metadata: { ...project.metadata, thumbnailDataUrl, updatedAt: Date.now() },
  };

  const formData = new FormData();
  formData.append("project", JSON.stringify(projectToSave));

  // Only media the service doesn't already have goes with the save (see planMediaUpload); files
  // it holds stay in place, since a save prunes by what the project lists, not by what was sent.
  const plan = await planMediaUpload(project, await listServerMedia(project.id));
  for (const { sourceId, blob } of plan.upload) {
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
    }),
  );

  return { ...project, sources: hydratedSources };
}

export async function deleteProjectFromServer(projectId: string): Promise<void> {
  const response = await fetch(`${RENDER_SERVICE_URL}/projects/${projectId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete project");
}
