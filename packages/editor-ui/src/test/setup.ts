import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach } from "vitest";

// fake-indexeddb stores records with Node's structuredClone, which can't clone jsdom's Blob (it
// comes back as an empty object with no size). Node's Blob IS cloneable, so it stands in for the
// browser's here — blobs written to the fake database read back byte-for-byte.
Object.defineProperty(globalThis, "Blob", { value: NodeBlob, configurable: true, writable: true });

// jsdom has no WebCrypto `subtle` and (depending on version) no Blob.arrayBuffer — both are used
// by content-addressed media ids. Node's implementations are exact stand-ins.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// jsdom has no canvas. Text layout only needs `measureText`, so a 2D context that measures text
// as 0.6em per character is enough to make wrapping deterministic and assertable.
export const FAKE_CHAR_WIDTH_EM = 0.6;

class FakeContext2D {
  font = "";
  measureText(text: string) {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
    return { width: text.length * px * FAKE_CHAR_WIDTH_EM };
  }
}

// Guarded: a test file can opt into `@vitest-environment node`, where there's no DOM at all.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return new FakeContext2D() as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

if (typeof URL.createObjectURL !== "function") {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
}

// Each test starts from an empty database.
afterEach(async () => {
  const names = (await indexedDB.databases?.())?.map((d) => d.name).filter((n): n is string => !!n) ?? ["reel-studio"];
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        }),
    ),
  );
});
