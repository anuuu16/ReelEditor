import {
  deleteImageMediaBlob,
  deleteImageProject,
  listImageMediaSizes,
  listImageProjects,
  listImageTemplates,
  loadImageProject,
  measureOtherStores,
  migrateLegacyImageProject,
  saveImageProject,
  type ImageProjectRecord,
  type SavedImageTemplate,
} from "../persistence/db.js";
import { referencedMediaIds, type ImageDocument } from "./document.js";

/**
 * Media ids are content hashes: the same file loaded twice — into one project, into two projects,
 * or kept by a template — resolves to the same id and is stored exactly once.
 */
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bytes a document's JSON takes on disk (structured clone is close enough to JSON for our shapes). */
export function documentBytes(doc: ImageDocument): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

/** Projects, most recently updated first — after folding in a v5 single-slot document if one is left. */
export async function listImageProjectsWithMigration(): Promise<ImageProjectRecord[]> {
  await migrateLegacyImageProject().catch((err) => console.error("Legacy image project migration failed", err));
  return listImageProjects();
}

export async function duplicateImageProject(id: string): Promise<ImageProjectRecord | null> {
  const source = await loadImageProject(id);
  if (!source) return null;
  const now = Date.now();
  // Media is shared by hash, so a duplicate costs only its document + thumbnail.
  const copy: ImageProjectRecord = { ...source, id: crypto.randomUUID(), name: `${source.name} copy`, createdAt: now, updatedAt: now };
  await saveImageProject(copy);
  return copy;
}

/** Every media id some project or template still needs. */
export async function collectReferencedMediaIds(): Promise<Set<string>> {
  const [projects, templates] = await Promise.all([listImageProjects(), listImageTemplates()]);
  const ids = new Set<string>();
  for (const project of projects) for (const id of referencedMediaIds(project.doc)) ids.add(id);
  for (const template of templates) for (const id of referencedMediaIds(template.config)) ids.add(id);
  return ids;
}

/**
 * Deletes stored blobs nothing refers to any more. `keep` protects ids an open editor may still
 * bring back through undo even though its saved document doesn't reference them right now.
 */
export async function purgeUnreferencedMedia(keep: Iterable<string> = []): Promise<{ deleted: number; bytes: number }> {
  const referenced = await collectReferencedMediaIds();
  for (const id of keep) referenced.add(id);
  let deleted = 0;
  let bytes = 0;
  for (const entry of await listImageMediaSizes()) {
    if (referenced.has(entry.id)) continue;
    await deleteImageMediaBlob(entry.id);
    deleted += 1;
    bytes += entry.bytes;
  }
  return { deleted, bytes };
}

/** Removes a project and any media only it was using. */
export async function deleteImageProjectAndMedia(id: string): Promise<void> {
  await deleteImageProject(id);
  await purgeUnreferencedMedia();
}

// ---------------------------------------------------------------------------------------------
// Storage analysis

export interface ProjectStorage {
  id: string;
  name: string;
  updatedAt: number;
  docBytes: number;
  thumbnailBytes: number;
  /** Bytes of every blob the project references (blobs shared with other projects are counted here too). */
  mediaBytes: number;
  /** The part of `mediaBytes` that only this project uses — what deleting it would actually free. */
  exclusiveMediaBytes: number;
  mediaCount: number;
  layerCount: number;
}

export interface ImageStorageReport {
  projects: ProjectStorage[];
  templates: Array<{ id: string; name: string; bytes: number; mediaBytes: number }>;
  media: { count: number; bytes: number; sharedCount: number; unusedCount: number; unusedBytes: number };
  /** Bytes the media would take if every project and template kept its own copy — what dedup saves. */
  mediaBytesIfCopied: number;
  other: { videoMedia: number; savedImages: number; savedAudio: number; audioMedia: number };
  /** Everything above added up (the Image Editor's share is projects + templates + media). */
  imageEditorBytes: number;
  totalBytes: number;
  /** From navigator.storage.estimate(), when the browser offers it. */
  quota: { usage: number; quota: number } | null;
}

export async function analyzeImageStorage(): Promise<ImageStorageReport> {
  const [projects, templates, mediaSizes, other] = await Promise.all([
    listImageProjects(),
    listImageTemplates(),
    listImageMediaSizes(),
    measureOtherStores(),
  ]);
  const sizeOf = new Map(mediaSizes.map((m) => [m.id, m.bytes]));
  const refCount = new Map<string, number>();
  const count = (ids: string[]) => {
    for (const id of new Set(ids)) refCount.set(id, (refCount.get(id) ?? 0) + 1);
  };
  for (const p of projects) count(referencedMediaIds(p.doc));
  for (const t of templates) count(referencedMediaIds(t.config));

  let mediaBytesIfCopied = 0;
  const projectReports: ProjectStorage[] = projects.map((p) => {
    const ids = Array.from(new Set(referencedMediaIds(p.doc)));
    const mediaBytes = ids.reduce((acc, id) => acc + (sizeOf.get(id) ?? 0), 0);
    mediaBytesIfCopied += mediaBytes;
    return {
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      docBytes: documentBytes(p.doc),
      thumbnailBytes: p.thumbnail?.size ?? 0,
      mediaBytes,
      exclusiveMediaBytes: ids.filter((id) => refCount.get(id) === 1).reduce((acc, id) => acc + (sizeOf.get(id) ?? 0), 0),
      mediaCount: ids.length,
      layerCount: p.doc.layers.length,
    };
  });
  const templateReports = templates.map((t: SavedImageTemplate) => {
    const ids = Array.from(new Set(referencedMediaIds(t.config)));
    const mediaBytes = ids.reduce((acc, id) => acc + (sizeOf.get(id) ?? 0), 0);
    mediaBytesIfCopied += mediaBytes;
    const inline = Object.values(t.media ?? {}).reduce((acc, b) => acc + b.size, 0);
    return {
      id: t.id,
      name: t.name,
      bytes: new TextEncoder().encode(JSON.stringify(t.config)).length + (t.thumbnailDataUrl?.length ?? 0) + inline,
      mediaBytes,
    };
  });

  const unused = mediaSizes.filter((m) => !refCount.has(m.id));
  const media = {
    count: mediaSizes.length,
    bytes: mediaSizes.reduce((acc, m) => acc + m.bytes, 0),
    sharedCount: Array.from(refCount.values()).filter((n) => n > 1).length,
    unusedCount: unused.length,
    unusedBytes: unused.reduce((acc, m) => acc + m.bytes, 0),
  };
  const projectBytes = projectReports.reduce((acc, p) => acc + p.docBytes + p.thumbnailBytes, 0);
  const templateBytes = templateReports.reduce((acc, t) => acc + t.bytes, 0);
  const imageEditorBytes = projectBytes + templateBytes + media.bytes;
  const totalBytes = imageEditorBytes + other.videoMedia + other.savedImages + other.savedAudio + other.audioMedia;

  let quota: ImageStorageReport["quota"] = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate && estimate.usage !== undefined && estimate.quota !== undefined) quota = { usage: estimate.usage, quota: estimate.quota };
  } catch {
    /* not available — fine */
  }

  return { projects: projectReports, templates: templateReports, media, mediaBytesIfCopied, other, imageEditorBytes, totalBytes, quota };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
