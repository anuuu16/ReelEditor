import { useCallback, useEffect, useRef, useState } from "react";
import { hasImageMediaBlob, listImageMediaIds, loadImageMediaBlob, saveImageMediaBlob } from "../persistence/db.js";
import { hashBlob } from "./storage.js";
import type { LoadedMedia, MediaMap } from "./renderImage.js";

/** Decodes a blob into drawable media under the given id (the object URL is the caller's to revoke). */
export function decodeImageBlob(id: string, blob: Blob): Promise<LoadedMedia> {
  return decodeBlob(id, blob);
}

function decodeBlob(id: string, blob: Blob): Promise<LoadedMedia> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ id, blob, url, image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Not a readable image"));
    };
    image.src = url;
  });
}

export interface ImageMediaStore {
  media: MediaMap;
  /**
   * Decodes a blob, keeps it in memory and writes it to storage. The media id is the blob's
   * content hash, so adding the same file again is free — it resolves to the existing entry.
   */
  add: (blob: Blob) => Promise<LoadedMedia>;
  /** Pulls the given ids out of storage; returns the ones that are now available in memory. */
  restore: (ids: string[]) => Promise<string[]>;
  /**
   * Re-writes any referenced blob that's missing from storage: it can be in memory but gone from
   * disk after a purge ran while an undo later brought a removed layer back.
   */
  sync: (referencedIds: string[]) => Promise<void>;
}

// All decoded images live in one map for the whole editor session — including ones the document
// no longer references, because undo/redo can bring them back at any time.
export function useImageMedia(): ImageMediaStore {
  const [media, setMedia] = useState<MediaMap>({});
  const mediaRef = useRef<MediaMap>({});
  const storedIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const snapshot = mediaRef;
    return () => {
      for (const item of Object.values(snapshot.current)) if (item.url) URL.revokeObjectURL(item.url);
    };
  }, []);

  const put = useCallback((item: LoadedMedia) => {
    mediaRef.current = { ...mediaRef.current, [item.id]: item };
    setMedia(mediaRef.current);
  }, []);

  async function knownStoredIds(): Promise<Set<string>> {
    if (!storedIds.current) storedIds.current = new Set(await listImageMediaIds().catch(() => []));
    return storedIds.current;
  }

  const add = useCallback<ImageMediaStore["add"]>(
    async (blob) => {
      const id = await hashBlob(blob);
      const existing = mediaRef.current[id];
      if (existing) return existing;
      const item = await decodeBlob(id, blob);
      put(item);
      // Persisted immediately, while the blob is on hand — a reload mid-session still finds it.
      try {
        const stored = await knownStoredIds();
        if (!stored.has(id)) {
          await saveImageMediaBlob(id, blob);
          stored.add(id);
        }
      } catch (err) {
        console.error("Could not store image", err);
      }
      return item;
    },
    [put],
  );

  const restore = useCallback<ImageMediaStore["restore"]>(
    async (ids) => {
      const stored = await knownStoredIds();
      const available: string[] = [];
      for (const id of ids) {
        if (mediaRef.current[id]) {
          available.push(id);
          continue;
        }
        const blob = await loadImageMediaBlob(id).catch(() => null);
        if (!blob) continue;
        stored.add(id);
        try {
          put(await decodeBlob(id, blob));
          available.push(id);
        } catch {
          /* unreadable — treated as missing */
        }
      }
      return available;
    },
    [put],
  );

  const sync = useCallback<ImageMediaStore["sync"]>(async (referencedIds) => {
    const stored = await knownStoredIds();
    for (const id of new Set(referencedIds)) {
      const item = mediaRef.current[id];
      if (!item || item.blob.size === 0) continue;
      // Another tab (or the Storage page) may have purged it: verify against storage, not just the cache.
      if (await hasImageMediaBlob(id).catch(() => false)) continue;
      await saveImageMediaBlob(id, item.blob).catch((err) => console.error("Could not store image", err));
      stored.add(id);
    }
  }, []);

  return { media, add, restore, sync };
}
