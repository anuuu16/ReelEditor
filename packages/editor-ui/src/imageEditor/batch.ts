import { applyTemplateConfig, createDefaultDocument, type ImageDocument, type OutputFormat, type TemplateConfig } from "./document.js";
import { FORMAT_INFO } from "./renderImage.js";

/**
 * Batch export: one template's look applied to many images, every result rendered at the
 * template's output size. The pipeline here is pure (rendering is injected), so it can be
 * exercised without a canvas.
 */

export type BatchStatus = "pending" | "rendering" | "done" | "error" | "skipped";

export interface BatchItem {
  id: string;
  /** File name without extension — what `{name}` expands to. */
  name: string;
  file: Blob;
  status: BatchStatus;
  output?: Blob;
  error?: string;
}

export interface BatchOptions {
  format: OutputFormat;
  quality: number;
  /** Output file name pattern, e.g. "{name}-{template}". See `batchFileName` for the tokens. */
  namePattern: string;
}

export const DEFAULT_NAME_PATTERN = "{name}-{template}";

/** The document a batch renders for one image: a fresh document, the template's look, that photo. */
export function buildBatchDocument(config: TemplateConfig, sourceMediaId: string, sourceName: string): ImageDocument {
  return applyTemplateConfig({ ...createDefaultDocument(), sourceMediaId, sourceName }, config);
}

/** Strips an extension from a file name; "IMG_0042.JPG" → "IMG_0042". */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, "") || "image";
}

/** Characters that can't appear in a file name on some OS are replaced, so a zip entry never fails to extract. */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "_")
      .split("")
      .map((c) => (c.charCodeAt(0) < 32 ? "_" : c))
      .join("")
      .replace(/\s+/g, " ")
      .trim() || "image"
  );
}

export interface NameVars {
  name: string;
  index: number; // 1-based
  total: number;
  template: string;
  width: number;
  height: number;
}

/**
 * Expands a pattern: {name} {index} {template} {width} {height} {date}. {index} is zero-padded to
 * the batch size, so files sort correctly. The extension is appended from the format.
 */
export function batchFileName(pattern: string, vars: NameVars, format: OutputFormat): string {
  const digits = Math.max(2, String(vars.total).length);
  const date = new Date().toISOString().slice(0, 10);
  const expanded = (pattern.trim() || DEFAULT_NAME_PATTERN)
    .replace(/\{name\}/g, vars.name)
    .replace(/\{index\}/g, String(vars.index).padStart(digits, "0"))
    .replace(/\{template\}/g, vars.template)
    .replace(/\{width\}/g, String(vars.width))
    .replace(/\{height\}/g, String(vars.height))
    .replace(/\{date\}/g, date);
  return `${safeFileName(expanded)}.${FORMAT_INFO[format].ext}`;
}

/** Makes every name in a batch unique by suffixing duplicates: a.png, a (2).png, a (3).png. */
export function uniqueFileNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}

export interface RunBatchOptions<T extends BatchItem> {
  /** Renders one item to its output blob. Throwing marks that item as failed; the rest continue. */
  render: (item: T) => Promise<Blob>;
  /** Called after each item changes status, with the full, updated list. */
  onProgress?: (items: T[], done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Renders items one at a time (each render owns the GPU/canvas for a moment; parallelism would
 * only thrash memory with large photos). One failure never stops the others, and aborting marks
 * everything not yet rendered as skipped.
 */
export async function runBatch<T extends BatchItem>(items: T[], options: RunBatchOptions<T>): Promise<T[]> {
  let current = items.map((item) =>
    item.status === "done" ? item : { ...item, status: "pending" as const, output: undefined, error: undefined },
  );
  const total = current.length;
  const report = () => options.onProgress?.(current, current.filter((i) => i.status === "done" || i.status === "error").length, total);

  for (let i = 0; i < current.length; i++) {
    if (current[i].status === "done") continue;
    if (options.signal?.aborted) {
      current = current.map((item) => (item.status === "pending" ? { ...item, status: "skipped" as const } : item));
      report();
      break;
    }
    current = current.map((item, j) => (j === i ? { ...item, status: "rendering" as const } : item));
    report();
    try {
      const output = await options.render(current[i]);
      current = current.map((item, j) => (j === i ? { ...item, status: "done" as const, output } : item));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      current = current.map((item, j) => (j === i ? { ...item, status: "error" as const, error } : item));
    }
    report();
  }
  return current;
}

/** The (name, blob) pairs a finished batch contributes to a zip — failed/skipped items are left out. */
export function collectOutputs<T extends BatchItem>(
  items: T[],
  options: BatchOptions,
  template: string,
  size: { width: number; height: number },
) {
  const done = items.filter((item): item is T & { output: Blob } => item.status === "done" && !!item.output);
  const names = uniqueFileNames(
    done.map((item) =>
      batchFileName(
        options.namePattern,
        { name: item.name, index: items.indexOf(item) + 1, total: items.length, template: safeFileName(template), ...size },
        options.format,
      ),
    ),
  );
  return done.map((item, i) => ({ name: names[i], blob: item.output }));
}
