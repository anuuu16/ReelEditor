import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const SAMPLES = {
  huge: path.resolve(import.meta.dirname, "../../../samples/photo-huge-9000x6000.jpg"),
  tiny: path.resolve(import.meta.dirname, "../../../samples/photo-tiny-160x90.png"),
  logo: path.resolve(import.meta.dirname, "../../../samples/logo-transparent.png"),
  phone: path.resolve(import.meta.dirname, "../../../samples/photo-phone-exif-rotated.jpg"),
  landscape: path.resolve(import.meta.dirname, "../../../samples/photo-landscape-4000x3000.jpg"),
};

export type Format = "PNG" | "JPEG" | "WebP";

/** A brand-new image project in a clean database. */
export async function openFreshEditor(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("reel-studio");
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      }),
  );
  await page.goto("/image-editor");
  await page.waitForURL(/\/image-editor\/[0-9a-f-]{36}$/);
  await page.getByText("Choose, drop, or paste an image").waitFor();
}

export async function loadPhoto(page: Page, file: string): Promise<number> {
  const started = Date.now();
  await page.locator(".ie-section:has(h3:text-is('Source')) input[type=file]").setInputFiles(file);
  await page.locator("canvas.ie-canvas").waitFor();
  // The source line appears once the image is decoded and the document committed.
  await page.locator(".ie-section:has(h3:text-is('Source')) .hint").last().waitFor();
  return Date.now() - started;
}

/** Sets a SliderField in the right-hand (contextual) column by its label. */
export async function setSlider(page: Page, label: string, value: number): Promise<void> {
  await page.evaluate(
    ([label, value]) => {
      const labels = Array.from(document.querySelectorAll<HTMLSpanElement>(".ie-body > .ie-controls:last-child .field > span"));
      const span = labels.find((s) => s.textContent?.startsWith(label as string));
      const range = span?.parentElement?.querySelector<HTMLInputElement>("input[type=range]");
      if (!range) throw new Error(`No slider labelled "${label}"`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(range, String(value));
      range.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [label, value] as const,
  );
}

export async function selectFormat(page: Page, format: Format): Promise<void> {
  await page.locator(`.ie-section:has(h3:text-is('Export')) button:text-is('${format}')`).click();
}

/** Clicks Download and returns the file's bytes plus how long the export took. */
export async function downloadExport(page: Page): Promise<{ bytes: Buffer; ms: number; fileName: string }> {
  const started = Date.now();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { bytes: Buffer.concat(chunks), ms: Date.now() - started, fileName: download.suggestedFilename() };
}

export function formatOf(bytes: Buffer): Format | "unknown" {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "PNG";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "JPEG";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "WebP";
  return "unknown";
}

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA of the top-left pixel. */
  corner: number[];
  /** RGBA of the centre pixel. */
  center: number[];
  transparentPixels: number;
}

/** Decodes an exported file with the browser's own decoder and samples it. */
export async function decodeInPage(page: Page, bytes: Buffer, mime: string): Promise<DecodedImage> {
  return page.evaluate(
    async ([b64, mime]) => {
      const binary = atob(b64);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparentPixels = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) transparentPixels++;
      const at = (x: number, y: number) => Array.from(pixels.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));
      return {
        width: canvas.width,
        height: canvas.height,
        corner: at(2, 2),
        center: at(canvas.width >> 1, canvas.height >> 1),
        transparentPixels,
      };
    },
    [bytes.toString("base64"), mime] as const,
  );
}

export interface PixelComparison {
  width: number;
  height: number;
  sameSize: boolean;
  differingPixels: number;
  /** Mean absolute channel difference over every RGBA channel, 0..255. */
  meanDiff: number;
  maxDiff: number;
}

/** Compares an exported file, decoded in the browser, against the live preview canvas pixel by pixel. */
export async function compareWithPreview(page: Page, bytes: Buffer, mime: string): Promise<PixelComparison> {
  return page.evaluate(
    async ([b64, mime]) => {
      const binary = atob(b64);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
      const preview = document.querySelector<HTMLCanvasElement>("canvas.ie-canvas")!;
      const sameSize = bitmap.width === preview.width && bitmap.height === preview.height;
      if (!sameSize) return { width: bitmap.width, height: bitmap.height, sameSize, differingPixels: -1, meanDiff: -1, maxDiff: -1 };
      const scratch = document.createElement("canvas");
      scratch.width = bitmap.width;
      scratch.height = bitmap.height;
      const sctx = scratch.getContext("2d")!;
      sctx.drawImage(bitmap, 0, 0);
      const a = sctx.getImageData(0, 0, scratch.width, scratch.height).data;
      const b = preview.getContext("2d")!.getImageData(0, 0, preview.width, preview.height).data;
      let differingPixels = 0;
      let total = 0;
      let maxDiff = 0;
      for (let i = 0; i < a.length; i += 4) {
        let pixelDiff = 0;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          total += d;
          if (d > maxDiff) maxDiff = d;
          if (d > 0) pixelDiff++;
        }
        if (pixelDiff > 0) differingPixels++;
      }
      return { width: bitmap.width, height: bitmap.height, sameSize, differingPixels, meanDiff: total / a.length, maxDiff };
    },
    [bytes.toString("base64"), mime] as const,
  );
}

/** Durations (ms) of every preview render recorded since the last call. */
export async function takeRenderTimings(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByName("image-editor:render").map((e) => e.duration);
    performance.clearMeasures("image-editor:render");
    return entries;
  });
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export async function selectionCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(".ie-layer-selection").boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

export const MIME: Record<Format, string> = { PNG: "image/png", JPEG: "image/jpeg", WebP: "image/webp" };
