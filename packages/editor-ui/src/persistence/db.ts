import type { ProjectModel } from "@reel-studio/shared-types";
import type { AudioClip, TimelineNote } from "../audioEditor/timeline.js";

const DB_NAME = "reel-studio";
const DB_VERSION = 4;
const PROJECT_STORE = "project";
const MEDIA_STORE = "media";
const IMAGE_STORE = "savedImages";
const AUDIO_STORE = "savedAudio";
const AUDIO_PROJECT_STORE = "audioProject";
const AUDIO_MEDIA_STORE = "audioMedia";
const PROJECT_KEY = "current";
const EXPECTED_STORES = [PROJECT_STORE, MEDIA_STORE, IMAGE_STORE, AUDIO_STORE, AUDIO_PROJECT_STORE, AUDIO_MEDIA_STORE];

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

async function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
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
}

export async function saveAudioProject(project: PersistedAudioProject): Promise<void> {
  await runTransaction(AUDIO_PROJECT_STORE, "readwrite", (store) => store.put(project, PROJECT_KEY));
}

export async function loadAudioProject(): Promise<PersistedAudioProject | null> {
  const result = await runTransaction<PersistedAudioProject | undefined>(AUDIO_PROJECT_STORE, "readonly", (store) =>
    store.get(PROJECT_KEY)
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
