import type { ProjectModel } from "@reel-studio/shared-types";

const DB_NAME = "reel-studio";
const DB_VERSION = 1;
const PROJECT_STORE = "project";
const MEDIA_STORE = "media";
const PROJECT_KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE);
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
