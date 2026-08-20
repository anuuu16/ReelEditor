import { RENDER_SERVICE_URL } from "../constants.js";
import type {
  CreateStudioProjectBody,
  PatchStudioResourceBody,
  StudioProject,
  StudioProjectSummary,
  StudioResource,
  UploadStudioResourceFields,
} from "./types.js";

async function readJson<T>(response: Response, fallbackError: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: fallbackError }));
    throw new Error(body.error ?? fallbackError);
  }
  return response.json();
}

export function studioResourceUrl(studioId: string, resourceId: string): string {
  return `${RENDER_SERVICE_URL}/studio/${studioId}/resources/${resourceId}`;
}

export function studioGenerateUrl(studioId: string): string {
  return `${RENDER_SERVICE_URL}/studio/${studioId}/generate`;
}

export async function listStudioProjects(): Promise<StudioProjectSummary[]> {
  const response = await fetch(`${RENDER_SERVICE_URL}/studio`);
  return readJson(response, "Failed to list Studio projects");
}

export async function createStudioProject(body: CreateStudioProjectBody): Promise<StudioProject> {
  const response = await fetch(`${RENDER_SERVICE_URL}/studio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(response, "Failed to create Studio project");
}

export async function getStudioProject(studioId: string): Promise<StudioProject> {
  const response = await fetch(`${RENDER_SERVICE_URL}/studio/${studioId}`);
  return readJson(response, "Studio project not found");
}

export async function patchStudioProject(studioId: string, patch: Partial<StudioProject>): Promise<StudioProject> {
  const response = await fetch(`${RENDER_SERVICE_URL}/studio/${studioId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readJson(response, "Failed to update Studio project");
}

export async function deleteStudioProject(studioId: string): Promise<{ status: "deleted" }> {
  const response = await fetch(`${RENDER_SERVICE_URL}/studio/${studioId}`, { method: "DELETE" });
  return readJson(response, "Failed to delete Studio project");
}

export async function uploadStudioResource(
  studioId: string,
  file: File,
  fields: UploadStudioResourceFields
): Promise<StudioResource> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", fields.kind);
  if (fields.language) formData.append("language", fields.language);
  if (fields.sceneN !== undefined) formData.append("sceneN", String(fields.sceneN));

  const response = await fetch(`${RENDER_SERVICE_URL}/studio/${studioId}/resources`, {
    method: "POST",
    body: formData,
  });
  return readJson(response, "Failed to upload resource");
}

export async function patchStudioResource(
  studioId: string,
  resourceId: string,
  patch: PatchStudioResourceBody
): Promise<StudioResource> {
  const response = await fetch(`${RENDER_SERVICE_URL}/studio/${studioId}/resources/${resourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readJson(response, "Failed to update resource");
}

export async function deleteStudioResource(studioId: string, resourceId: string): Promise<{ status: "deleted" }> {
  const response = await fetch(`${RENDER_SERVICE_URL}/studio/${studioId}/resources/${resourceId}`, { method: "DELETE" });
  return readJson(response, "Failed to delete resource");
}
