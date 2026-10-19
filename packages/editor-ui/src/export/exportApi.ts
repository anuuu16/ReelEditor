import type { ExportJobSummary, ExportOutput, ExportStreamMessage, ProjectModel, QueueMoveDirection } from "@reel-studio/shared-types";
import { RENDER_SERVICE_URL } from "../constants.js";
import { listServerMedia, planMediaUpload, type StoredMediaEntry } from "../persistence/projectServer.js";

// The editor's side of the render service's export queue. The service is the source of truth for
// every job — nothing about an export is kept in the browser — which is what lets a reload (or a
// service restart) pick up exactly where things were: the panel just asks again.

export class RenderServiceUnreachableError extends Error {
  constructor() {
    super(
      `Couldn't reach the render service at ${RENDER_SERVICE_URL}. Make sure it's running (pnpm --filter @reel-studio/render-service dev).`,
    );
    this.name = "RenderServiceUnreachableError";
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/**
 * One multipart request for an export: the project, the outputs, and for each used source either
 * its file or — when the saved project on the service already has that exact file — just a
 * reference to it (`mediaRefs`), which the service copies from the project's folder instead.
 * Throws if a source has no stored file at all.
 */
export async function buildExportForm(
  project: ProjectModel,
  outputs: ExportOutput[],
  stored: Record<string, StoredMediaEntry> = {},
  forceUpload: ReadonlySet<string> = new Set(),
): Promise<FormData> {
  const plan = await planMediaUpload(project, stored, forceUpload);
  if (plan.missing.length > 0) {
    const source = project.sources.find((s) => s.id === plan.missing[0]);
    throw new Error(`Missing stored file for "${source?.name ?? plan.missing[0]}" — re-import it before exporting.`);
  }
  const form = new FormData();
  form.append("project", JSON.stringify(project));
  form.append("outputs", JSON.stringify(outputs));
  if (Object.keys(plan.refs).length > 0) form.append("mediaRefs", JSON.stringify(plan.refs));
  for (const { sourceId, blob } of plan.upload) form.append(`media_${sourceId}`, blob, sourceId);
  return form;
}

/** One upload, one job per output. Resolves once the service has queued them all. */
export async function startExport(project: ProjectModel, outputs: ExportOutput[], signal?: AbortSignal): Promise<ExportJobSummary[]> {
  const stored = await listServerMedia(project.id);
  let forceUpload: ReadonlySet<string> = new Set();
  // Normally one request. If the service turns out not to have a file we referred to after all
  // (saved project changed under us, file lost), it says which — and those go up the old way.
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = await buildExportForm(project, outputs, stored, forceUpload);
    let response: Response;
    try {
      response = await fetch(`${RENDER_SERVICE_URL}/render`, { method: "POST", body: form, signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new RenderServiceUnreachableError();
    }
    if (response.status === 409 && attempt === 0) {
      const body = (await response.json().catch(() => null)) as { error?: string; missingSourceIds?: string[] } | null;
      if (body?.missingSourceIds?.length) {
        forceUpload = new Set(body.missingSourceIds);
        continue;
      }
      throw new Error(body?.error ?? "Export request failed");
    }
    if (!response.ok) throw new Error(await readError(response, "Export request failed"));
    return ((await response.json()) as { jobs: ExportJobSummary[] }).jobs;
  }
  throw new Error("Export request failed");
}

function projectQuery(projectId: string | null | undefined): string {
  return projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
}

/** Every export the service has — for one project, or (no id) for all of them. */
export async function listExportJobs(projectId?: string | null): Promise<ExportJobSummary[]> {
  let response: Response;
  try {
    response = await fetch(`${RENDER_SERVICE_URL}/render${projectQuery(projectId)}`);
  } catch {
    throw new RenderServiceUnreachableError();
  }
  if (!response.ok) throw new Error(await readError(response, "Couldn't list exports"));
  return (await response.json()) as ExportJobSummary[];
}

export async function cancelExportJob(jobId: string): Promise<void> {
  await fetch(`${RENDER_SERVICE_URL}/render/${jobId}/cancel`, { method: "POST" }).catch(() => {});
}

export async function deleteExportJob(jobId: string): Promise<void> {
  await fetch(`${RENDER_SERVICE_URL}/render/${jobId}`, { method: "DELETE" }).catch(() => {});
}

/** Moves a waiting export in the line. Resolves to the line as the service now has it. */
export async function moveExportJob(jobId: string, direction: QueueMoveDirection): Promise<ExportJobSummary[]> {
  let response: Response;
  try {
    response = await fetch(`${RENDER_SERVICE_URL}/render/${jobId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
  } catch {
    throw new RenderServiceUnreachableError();
  }
  if (!response.ok) throw new Error(await readError(response, "Couldn't move this export"));
  return ((await response.json()) as { line: ExportJobSummary[] }).line;
}

/** Runs a failed/cancelled export again with the same settings; resolves to its replacement. */
export async function retryExportJob(jobId: string): Promise<ExportJobSummary> {
  let response: Response;
  try {
    response = await fetch(`${RENDER_SERVICE_URL}/render/${jobId}/retry`, { method: "POST" });
  } catch {
    throw new RenderServiceUnreachableError();
  }
  if (!response.ok) throw new Error(await readError(response, "Couldn't retry this export"));
  return (await response.json()) as ExportJobSummary;
}

export function exportResultUrl(jobId: string): string {
  return `${RENDER_SERVICE_URL}/render/${jobId}/result`;
}

export interface ExportStreamHandlers {
  onMessage: (message: ExportStreamMessage) => void;
  /** Connected (or reconnected — the snapshot that follows replaces everything known so far). */
  onOpen?: () => void;
  /** The connection dropped; the browser keeps retrying on its own until `unsubscribe` is called. */
  onError?: () => void;
}

/** Follows every job of a project (or, with no id, every job there is) live. Returns the function that stops following. */
export function subscribeExportJobs(projectId: string | null | undefined, handlers: ExportStreamHandlers): () => void {
  const source = new EventSource(`${RENDER_SERVICE_URL}/render/events${projectQuery(projectId)}`);
  source.onopen = () => handlers.onOpen?.();
  source.onerror = () => handlers.onError?.();
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      handlers.onMessage(JSON.parse(event.data) as ExportStreamMessage);
    } catch {
      // A malformed line is not worth dropping the stream over.
    }
  };
  return () => source.close();
}
