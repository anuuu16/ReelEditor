import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteImageMediaBlob, listImageMediaIds, loadImageMediaBlob } from "../persistence/db.js";
import { hashBlob } from "./storage.js";
import { useImageMedia } from "./useImageMedia.js";

// jsdom never decodes images; this stand-in reports a size and fires onload on the next tick.
class FakeImage {
  naturalWidth = 640;
  naturalHeight = 480;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    queueMicrotask(() => (value.includes("broken") ? this.onerror?.() : this.onload?.()));
  }
}

describe("useImageMedia", () => {
  beforeEach(() => vi.stubGlobal("Image", FakeImage));
  afterEach(() => vi.unstubAllGlobals());

  it("adds a blob under its content hash, decodes it and persists it once", async () => {
    const { result } = renderHook(() => useImageMedia());
    const blob = new Blob(["same bytes"], { type: "image/png" });
    const id = await hashBlob(blob);

    let item = await act(() => result.current.add(blob));
    expect(item).toMatchObject({ id, width: 640, height: 480 });
    await waitFor(() => expect(result.current.media[id]).toBeDefined());

    // The same file again is a no-op that resolves to the existing entry.
    item = await act(() => result.current.add(new Blob(["same bytes"])));
    expect(item.id).toBe(id);
    expect(await listImageMediaIds()).toEqual([id]);
    expect((await loadImageMediaBlob(id))?.size).toBe(blob.size);
  });

  it("restore pulls stored blobs into memory and reports which ids were found", async () => {
    const { result } = renderHook(() => useImageMedia());
    const blob = new Blob(["stored"]);
    const id = await hashBlob(blob);
    await act(() => result.current.add(blob));

    const { result: fresh } = renderHook(() => useImageMedia());
    const available = await act(() => fresh.current.restore([id, "missing"]));
    expect(available).toEqual([id]);
    await waitFor(() => expect(fresh.current.media[id]?.width).toBe(640));
  });

  it("sync re-writes a referenced blob that was purged from storage behind its back", async () => {
    const { result } = renderHook(() => useImageMedia());
    const blob = new Blob(["keep me"]);
    const id = await hashBlob(blob);
    await act(() => result.current.add(blob));
    await deleteImageMediaBlob(id);
    expect(await loadImageMediaBlob(id)).toBeNull();

    await act(() => result.current.sync([id]));
    expect((await loadImageMediaBlob(id))?.size).toBe(blob.size);
  });
});
