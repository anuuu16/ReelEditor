import type { ClipFilter } from "@reel-studio/shared-types";

export type FilterPresetName = "none" | "warm" | "cool" | "mono" | "vintage";

export const NEUTRAL_FILTER: ClipFilter = { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 };

export const FILTER_PRESETS: Record<FilterPresetName, Omit<ClipFilter, "preset">> = {
  none: { brightness: 0, contrast: 1, saturation: 1, hue: 0 },
  warm: { brightness: 0.03, contrast: 1.05, saturation: 1.15, hue: -8 },
  cool: { brightness: 0, contrast: 1.05, saturation: 0.95, hue: 10 },
  mono: { brightness: 0, contrast: 1.1, saturation: 0, hue: 0 },
  vintage: { brightness: -0.05, contrast: 0.9, saturation: 0.7, hue: 6 },
};

export function applyFilterPreset(name: FilterPresetName): ClipFilter {
  return { preset: name === "none" ? null : name, ...FILTER_PRESETS[name] };
}

// CSS filter() functions and ffmpeg's eq/hue filters use the same conventions for contrast,
// saturation (1.0 = neutral, multiplicative) and hue-rotate (degrees) — but CSS brightness() is
// multiplicative (1.0 = neutral) while ffmpeg's eq brightness is additive (0.0 = neutral, -1..1).
// ClipFilter.brightness is stored in the ffmpeg/additive convention; the CSS side converts it.
export function buildCanvasFilterString(filter: ClipFilter): string {
  return `brightness(${1 + filter.brightness}) contrast(${filter.contrast}) saturate(${filter.saturation}) hue-rotate(${filter.hue}deg)`;
}

export function buildFfmpegColorFilter(filter: ClipFilter): string {
  const parts = [`eq=brightness=${filter.brightness}:contrast=${filter.contrast}:saturation=${filter.saturation}`];
  if (filter.hue !== 0) parts.push(`hue=h=${filter.hue}`);
  return parts.join(",");
}
