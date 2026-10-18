import type { ProjectModel } from "@reel-studio/shared-types";
import type { AudioClip, DuckingSettings, TimelineNote } from "../audioEditor/timeline.js";
import type { ImageDocument, TemplateConfig } from "../imageEditor/document.js";

const DB_NAME = "reel-studio";
const DB_VERSION = 6;
const PROJECT_STORE = "project";
const MEDIA_STORE = "media";
const IMAGE_STORE = "savedImages";
const AUDIO_STORE = "savedAudio";
const AUDIO_PROJECT_STORE = "audioProject";
const AUDIO_MEDIA_STORE = "audioMedia";
const IMAGE_PROJECT_STORE = "imageProject";
const IMAGE_MEDIA_STORE = "imageMedia";
const IMAGE_TEMPLATE_STORE = "imageTemplates";
const IMAGE_PROJECTS_STORE = "imageProjects";
const PROJECT_KEY = "current";
const EXPECTED_STORES = [
  PROJECT_STORE,
  MEDIA_STORE,
  IMAGE_STORE,
  AUDIO_STORE,
  AUDIO_PROJECT_STORE,
  AUDIO_MEDIA_STORE,
  IMAGE_PROJECT_STORE,
  IMAGE_MEDIA_STORE,
  IMAGE_TEMPLATE_STORE,
  IMAGE_PROJECTS_STORE,
];

function applySchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE);
  if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
  // v2: images exported from the Image Editor, kept separately from project media so they survive
  // independently of any project and can be listed on the Dashboard.
  if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
  // v3: audio exported from the Audio Editor — same "outlives any project" reasoning as images.
  if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE, { keyPath: "id" });
  // v4: the Audio Editor's own in-progress timeline (distinct from AUDIO_STORE's finished mixes) —
  // same "current" single-slot autosave as PROJECT_STORE, plus its own media store since a source's
  // original file blob (re-decoded on reload) has nothing to do with the video editor's media.
  if (!db.objectStoreNames.contains(AUDIO_PROJECT_STORE)) db.createObjectStore(AUDIO_PROJECT_STORE);
  if (!db.objectStoreNames.contains(AUDIO_MEDIA_STORE)) db.createObjectStore(AUDIO_MEDIA_STORE);
  // v5: the Image Editor's in-progress document (so a refresh no longer throws the edit away), the
  // blobs it references (photo, background image, image layers — keyed by media id), and
  // user-saved templates (a document's "look" minus the photo, reusable on other images).
  if (!db.objectStoreNames.contains(IMAGE_PROJECT_STORE)) db.createObjectStore(IMAGE_PROJECT_STORE);
  if (!db.objectStoreNames.contains(IMAGE_MEDIA_STORE)) db.createObjectStore(IMAGE_MEDIA_STORE);
  if (!db.objectStoreNames.contains(IMAGE_TEMPLATE_STORE)) db.createObjectStore(IMAGE_TEMPLATE_STORE, { keyPath: "id" });
  // v6: many named image projects (v5's single "current" slot is migrated into one of these on
  // first listing — see migrateLegacyImageProject). IMAGE_MEDIA_STORE is content-addressed from
  // here on: a blob's key is the SHA-256 of its bytes, so the same file used by several projects
  // or templates is stored exactly once and shared.
  if (!db.objectStoreNames.contains(IMAGE_PROJECTS_STORE)) db.createObjectStore(IMAGE_PROJECTS_STORE, { keyPath: "id" });
}

function open(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => applySchema(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return open(DB_VERSION).then((db) => {
    // Guard against a database that reached the current version without every store (a partial
    // upgrade, or a stray raw `indexedDB.open` elsewhere): reopen one version higher to re-run the
    // schema step, which only ever adds missing stores.
    if (EXPECTED_STORES.every((name) => db.objectStoreNames.contains(name))) return db;
    const bumped = db.version + 1;
    db.close();
    return open(bumped);
  });
}

async function runTransaction<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveProject(project: ProjectModel): Promise<void> {
  await runTransaction(PROJECT_STORE, "readwrite", (store) => store.put(project, PROJECT_KEY));
}

export async function loadProject(): Promise<ProjectModel | null> {
  const result = await runTransaction<ProjectModel | undefined>(PROJECT_STORE, "readonly", (store) => store.get(PROJECT_KEY));
  return result ?? null;
}

export async function saveMediaBlob(id: string, blob: Blob): Promise<void> {
  await runTransaction(MEDIA_STORE, "readwrite", (store) => store.put(blob, id));
}

export async function loadMediaBlob(id: string): Promise<Blob | null> {
  const result = await runTransaction<Blob | undefined>(MEDIA_STORE, "readonly", (store) => store.get(id));
  return result ?? null;
}

export async function deleteMediaBlob(id: string): Promise<void> {
  await runTransaction(MEDIA_STORE, "readwrite", (store) => store.delete(id));
}

export interface SavedImage {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  format: string;
  savedAt: number;
}

export async function saveImageToGallery(image: SavedImage): Promise<void> {
  await runTransaction(IMAGE_STORE, "readwrite", (store) => store.put(image));
}

export async function listSavedImages(): Promise<SavedImage[]> {
  const all = await runTransaction<SavedImage[]>(IMAGE_STORE, "readonly", (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSavedImage(id: string): Promise<void> {
  await runTransaction(IMAGE_STORE, "readwrite", (store) => store.delete(id));
}

export interface SavedAudio {
  id: string;
  name: string;
  blob: Blob;
  format: string;
  durationSeconds: number;
  savedAt: number;
}

export async function saveAudioToGallery(audio: SavedAudio): Promise<void> {
  await runTransaction(AUDIO_STORE, "readwrite", (store) => store.put(audio));
}

export async function listSavedAudio(): Promise<SavedAudio[]> {
  const all = await runTransaction<SavedAudio[]>(AUDIO_STORE, "readonly", (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSavedAudio(id: string): Promise<void> {
  await runTransaction(AUDIO_STORE, "readwrite", (store) => store.delete(id));
}

// The Audio Editor's own working project: clips are plain serializable data already, but each
// source's AudioBuffer is not what gets persisted — its original file blob goes into
// AUDIO_MEDIA_STORE (below) keyed by source id, and gets re-decoded back into an AudioBuffer on
// load. Only the source's id/name need to travel with the project record itself.
export interface PersistedAudioProject {
  sourceMeta: Array<{ id: string; name: string }>;
  clips: AudioClip[];
  notes: TimelineNote[];
  laneCount: number;
  /** Optional only because projects saved before auto-ducking existed won't have it — the loader
   * fills in DEFAULT_DUCKING when it's missing (see timeline.ts's migrateDucking). */
  ducking?: DuckingSettings;
}

export async function saveAudioProject(project: PersistedAudioProject): Promise<void> {
  await runTransaction(AUDIO_PROJECT_STORE, "readwrite", (store) => store.put(project, PROJECT_KEY));
}

export async function loadAudioProject(): Promise<PersistedAudioProject | null> {
  const result = await runTransaction<PersistedAudioProject | undefined>(AUDIO_PROJECT_STORE, "readonly", (store) =>
    store.get(PROJECT_KEY),
  );
  return result ?? null;
}

export async function saveAudioMediaBlob(id: string, blob: Blob): Promise<void> {
  await runTransaction(AUDIO_MEDIA_STORE, "readwrite", (store) => store.put(blob, id));
}

export async function loadAudioMediaBlob(id: string): Promise<Blob | null> {
  const result = await runTransaction<Blob | undefined>(AUDIO_MEDIA_STORE, "readonly", (store) => store.get(id));
  return result ?? null;
}

export async function deleteAudioMediaBlob(id: string): Promise<void> {
  await runTransaction(AUDIO_MEDIA_STORE, "readwrite", (store) => store.delete(id));
}

// ---------------------------------------------------------------------------------------------
// Image Editor

// A named image project. The document is plain JSON (see imageEditor/document.ts); every image
// it references lives in IMAGE_MEDIA_STORE under the media id the document uses (a content hash),
// and is decoded back into an <img> on load.
export interface ImageProjectRecord {
  id: string;
  name: string;
  doc: ImageDocument;
  createdAt: number;
  updatedAt: number;
  /** Small JPEG of the last render, for the Dashboard. A Blob rather than a data URL: a third smaller on disk. */
  thumbnail: Blob | null;
}

export async function saveImageProject(project: ImageProjectRecord): Promise<void> {
  await runTransaction(IMAGE_PROJECTS_STORE, "readwrite", (store) => store.put(project));
}

export async function loadImageProject(id: string): Promise<ImageProjectRecord | null> {
  const result = await runTransaction<ImageProjectRecord | undefined>(IMAGE_PROJECTS_STORE, "readonly", (store) => store.get(id));
  return result ?? null;
}

export async function listImageProjects(): Promise<ImageProjectRecord[]> {
  const all = await runTransaction<ImageProjectRecord[]>(IMAGE_PROJECTS_STORE, "readonly", (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteImageProject(id: string): Promise<void> {
  await runTransaction(IMAGE_PROJECTS_STORE, "readwrite", (store) => store.delete(id));
}

/** v5 kept one anonymous in-progress document; it becomes a regular project the first time v6 looks. */
export async function migrateLegacyImageProject(): Promise<ImageProjectRecord | null> {
  const legacy = await runTransaction<{ doc: ImageDocument; savedAt: number } | undefined>(IMAGE_PROJECT_STORE, "readonly", (store) =>
    store.get(PROJECT_KEY),
  ).catch(() => undefined);
  if (!legacy?.doc) return null;
  const record: ImageProjectRecord = {
    id: crypto.randomUUID(),
    name: legacy.doc.sourceName && legacy.doc.sourceName !== "image" ? legacy.doc.sourceName : "Untitled image",
    doc: legacy.doc,
    createdAt: legacy.savedAt ?? Date.now(),
    updatedAt: legacy.savedAt ?? Date.now(),
    thumbnail: null,
  };
  await saveImageProject(record);
  await runTransaction(IMAGE_PROJECT_STORE, "readwrite", (store) => store.delete(PROJECT_KEY));
  return record;
}

export async function saveImageMediaBlob(id: string, blob: Blob): Promise<void> {
  await runTransaction(IMAGE_MEDIA_STORE, "readwrite", (store) => store.put(blob, id));
}

export async function loadImageMediaBlob(id: string): Promise<Blob | null> {
  const result = await runTransaction<Blob | undefined>(IMAGE_MEDIA_STORE, "readonly", (store) => store.get(id));
  return result ?? null;
}

export async function hasImageMediaBlob(id: string): Promise<boolean> {
  const n = await runTransaction<number>(IMAGE_MEDIA_STORE, "readonly", (store) => store.count(IDBKeyRange.only(id)));
  return n > 0;
}

export async function listImageMediaIds(): Promise<string[]> {
  const keys = await runTransaction<IDBValidKey[]>(IMAGE_MEDIA_STORE, "readonly", (store) => store.getAllKeys());
  return (keys ?? []).map(String);
}

/** Every stored blob with its size — sizes come from Blob metadata, the bytes aren't read. */
export async function listImageMediaSizes(): Promise<Array<{ id: string; bytes: number }>> {
  const ids = await listImageMediaIds();
  const blobs = await runTransaction<Blob[]>(IMAGE_MEDIA_STORE, "readonly", (store) => store.getAll());
  return ids.map((id, index) => ({ id, bytes: blobs[index]?.size ?? 0 }));
}

export async function deleteImageMediaBlob(id: string): Promise<void> {
  await runTransaction(IMAGE_MEDIA_STORE, "readwrite", (store) => store.delete(id));
}

// A saved template references shared media by content hash like a project does; the blobs stay
// alive in IMAGE_MEDIA_STORE for as long as any project OR template refers to them.
export interface SavedImageTemplate {
  id: string;
  name: string;
  createdAt: number;
  thumbnailDataUrl: string | null;
  config: TemplateConfig;
  /** v5 templates carried private copies of their blobs; still honoured when applying one. */
  media?: Record<string, Blob>;
}

export async function saveImageTemplate(template: SavedImageTemplate): Promise<void> {
  await runTransaction(IMAGE_TEMPLATE_STORE, "readwrite", (store) => store.put(template));
}

export async function listImageTemplates(): Promise<SavedImageTemplate[]> {
  const all = await runTransaction<SavedImageTemplate[]>(IMAGE_TEMPLATE_STORE, "readonly", (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteImageTemplate(id: string): Promise<void> {
  await runTransaction(IMAGE_TEMPLATE_STORE, "readwrite", (store) => store.delete(id));
}

/** Byte totals of the other stores, for the Storage page — again from Blob metadata only. */
export async function measureOtherStores(): Promise<{ videoMedia: number; savedImages: number; savedAudio: number; audioMedia: number }> {
  const sum = (blobs: Array<Blob | { blob: Blob }>) =>
    blobs.reduce((acc, b) => acc + (b instanceof Blob ? b.size : (b.blob?.size ?? 0)), 0);
  const [videoMedia, savedImages, savedAudio, audioMedia] = await Promise.all([
    runTransaction<Blob[]>(MEDIA_STORE, "readonly", (store) => store.getAll()),
    runTransaction<SavedImage[]>(IMAGE_STORE, "readonly", (store) => store.getAll()),
    runTransaction<SavedAudio[]>(AUDIO_STORE, "readonly", (store) => store.getAll()),
    runTransaction<Blob[]>(AUDIO_MEDIA_STORE, "readonly", (store) => store.getAll()),
  ]);
  return {
    videoMedia: sum(videoMedia ?? []),
    savedImages: sum(savedImages ?? []),
    savedAudio: sum(savedAudio ?? []),
    audioMedia: sum(audioMedia ?? []),
  };
}
