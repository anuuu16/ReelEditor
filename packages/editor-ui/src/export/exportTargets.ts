import type { ExportFormatId, ExportOutput, ProjectModel } from "@reel-studio/shared-types";
import {
  buildDownloadName,
  computeExportDimensions,
  dedupeFileNames,
  DEFAULT_OUTPUT_FORMAT,
  EXPORT_PRESETS,
  getOutputFormat,
  QUALITY_TIERS,
  type ExportPreset,
  type QualityTier,
} from "@reel-studio/timeline-core";

// The Export panel's list of outputs: each row is a platform preset (optional — it only adds a
// label and a few sanity checks), a quality tier (which sets the pixel size, relative to the
// project canvas) and a format. These helpers turn rows into what the service is asked for.

export interface ExportTarget {
  id: string;
  presetId: string | null;
  qualityId: string;
  format: ExportFormatId;
}

export const DEFAULT_QUALITY_ID = "1080p";

let nextTargetId = 1;

export function createTarget(overrides: Partial<Omit<ExportTarget, "id">> = {}): ExportTarget {
  return {
    id: `target-${nextTargetId++}`,
    presetId: null,
    qualityId: DEFAULT_QUALITY_ID,
    format: DEFAULT_OUTPUT_FORMAT,
    ...overrides,
  };
}

export function presetOf(target: ExportTarget): ExportPreset | null {
  return EXPORT_PRESETS.find((p) => p.id === target.presetId) ?? null;
}

export function qualityOf(target: ExportTarget): QualityTier {
  return QUALITY_TIERS.find((q) => q.id === target.qualityId) ?? QUALITY_TIERS.find((q) => q.id === DEFAULT_QUALITY_ID) ?? QUALITY_TIERS[0];
}

export function outputFor(target: ExportTarget, project: ProjectModel): ExportOutput {
  const { width, height } = computeExportDimensions(project.canvas.width, project.canvas.height, qualityOf(target).scale);
  return { width, height, format: target.format, label: presetOf(target)?.label ?? null };
}

export function outputsFor(targets: ExportTarget[], project: ProjectModel): ExportOutput[] {
  return targets.map((target) => outputFor(target, project));
}

/** The file names the service will hand back, numbered the same way it numbers duplicates. */
export function fileNamesFor(targets: ExportTarget[], project: ProjectModel): string[] {
  const projectName = project.metadata.name;
  return dedupeFileNames(
    outputsFor(targets, project).map((output) =>
      buildDownloadName({ projectName, width: output.width, height: output.height, format: output.format, label: output.label }),
    ),
  );
}

/** Two rows asking for exactly the same file — pointless, so the panel flags it. */
export function duplicateTargetIds(targets: ExportTarget[]): Set<string> {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const target of targets) {
    const key = `${target.presetId ?? ""}|${target.qualityId}|${target.format}`;
    const first = seen.get(key);
    if (first) duplicates.add(target.id);
    else seen.set(key, target.id);
  }
  return duplicates;
}

export interface TargetWarnings {
  /** The preset's usual aspect ratio isn't the project's. */
  aspectMismatch: ExportPreset | null;
  /** The reel is longer than the preset allows. */
  overDuration: ExportPreset | null;
  /** The output is larger than the largest source frame — footage gets upscaled. */
  upscaleFrom: number | null;
  /** GIF drops the sound. */
  silent: boolean;
}

export function warningsFor(target: ExportTarget, project: ProjectModel, totalDuration: number, maxSourceLongEdge: number): TargetWarnings {
  const preset = presetOf(target);
  const output = outputFor(target, project);
  const targetLongEdge = Math.max(output.width, output.height);
  return {
    aspectMismatch: preset && preset.aspectRatio !== project.canvas.aspectRatio ? preset : null,
    overDuration: preset?.maxDurationSeconds != null && totalDuration > preset.maxDurationSeconds ? preset : null,
    upscaleFrom: maxSourceLongEdge > 0 && targetLongEdge > maxSourceLongEdge ? maxSourceLongEdge : null,
    silent: !getOutputFormat(target.format).hasAudio,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** "3s", "45s", "2m 05s" — how long a render took, or how long the reel is. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" — when an export was made. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
