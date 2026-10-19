// The container/codec combinations an export can be written as. Shared between the editor (the
// Export panel's format picker and the file names it previews) and the render service (the
// encoder arguments and the name the browser saves the download under), so the two can never
// disagree about what "webm" means.

import type { ExportFormatId } from "@reel-studio/shared-types";

export type OutputFormatId = ExportFormatId;

export interface OutputFormat {
  id: OutputFormatId;
  label: string;
  extension: string;
  mimeType: string;
  /** One line for the picker: what it's for and the trade-off. */
  description: string;
  /** GIF has no sound at all — the plan maps no audio stream for it. */
  hasAudio: boolean;
  /**
   * Roughly how much slower this encoder is than H.264 at the same size — the queue uses it to
   * decide whether two exports are cheap enough to run side by side (see job cost in the service).
   */
  encodeCostFactor: number;
}

export const OUTPUT_FORMATS: OutputFormat[] = [
  {
    id: "mp4",
    label: "MP4",
    extension: "mp4",
    mimeType: "video/mp4",
    description: "H.264 + AAC — plays everywhere, what every platform wants.",
    hasAudio: true,
    encodeCostFactor: 1,
  },
  {
    id: "webm",
    label: "WebM",
    extension: "webm",
    mimeType: "video/webm",
    description: "VP9 + Opus — smaller files for the web; slower to encode.",
    hasAudio: true,
    encodeCostFactor: 2,
  },
  {
    id: "mov",
    label: "MOV",
    extension: "mov",
    mimeType: "video/quicktime",
    description: "H.264 + AAC in a QuickTime container for Apple apps.",
    hasAudio: true,
    encodeCostFactor: 1,
  },
  {
    id: "gif",
    label: "GIF",
    extension: "gif",
    mimeType: "image/gif",
    description: "Animated GIF, no sound, 15 fps — keep it short and small.",
    hasAudio: false,
    encodeCostFactor: 1,
  },
];

export const DEFAULT_OUTPUT_FORMAT: OutputFormatId = "mp4";

export function isOutputFormatId(value: unknown): value is OutputFormatId {
  return typeof value === "string" && OUTPUT_FORMATS.some((f) => f.id === value);
}

export function getOutputFormat(id: OutputFormatId): OutputFormat {
  return OUTPUT_FORMATS.find((f) => f.id === id) ?? OUTPUT_FORMATS[0];
}

/** GIF frame rate: the usual trade-off between smoothness and file size for a short loop. */
export const GIF_FRAME_RATE = 15;

// The encoder half of the ffmpeg command line, after `-map`s and before `-t`/the output file.
// H.264: CRF 20 at "veryfast" is the speed/quality point the editor has always exported at.
// VP9: constant-quality mode (`-b:v 0`), row-based multithreading so it uses the cores it has.
export function buildEncoderArgs(formatId: OutputFormatId): string[] {
  switch (formatId) {
    case "webm":
      return [
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "33",
        "-b:v",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-row-mt",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
      ];
    case "gif":
      // The palette filters are part of the filter graph (see buildFfmpegPlan); nothing to add here.
      return [];
    case "mov":
    case "mp4":
    default:
      return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
      ];
  }
}

export interface DownloadNameParts {
  projectName: string;
  width: number;
  height: number;
  format: OutputFormatId;
  /** e.g. the platform preset ("Instagram Reel"), when one was picked. */
  label?: string | null;
}

// A file name that is safe on every OS: no path separators or reserved characters, no control
// characters, no leading/trailing dots or spaces (Windows), and not absurdly long.
export function sanitizeFileStem(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  return cleaned.slice(0, 120).trim();
}

/**
 * "My reel - Instagram Reel 1080x1920.mp4" — the project's name, what it was exported for (the
 * preset label, when there is one) and the pixel size, so several outputs of the same project
 * never collide or turn into a pile of "reel.mp4"s in the Downloads folder.
 */
export function buildDownloadName(parts: DownloadNameParts): string {
  const stem = sanitizeFileStem(parts.projectName) || "reel";
  const label = parts.label ? sanitizeFileStem(parts.label) : "";
  const size = `${parts.width}x${parts.height}`;
  const suffix = label ? `${label} ${size}` : size;
  return `${stem} - ${suffix}.${getOutputFormat(parts.format).extension}`;
}

/** Makes every name in the list unique by appending " (2)", " (3)" … before the extension. */
export function dedupeFileNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}
