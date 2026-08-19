import type { AspectRatioPreset } from "@reel-studio/shared-types";

export interface AspectPreset {
  id: Exclude<AspectRatioPreset, "custom">;
  width: number;
  height: number;
}

export const ASPECT_RATIO_PRESETS: AspectPreset[] = [
  { id: "9:16", width: 1080, height: 1920 },
  { id: "1:1", width: 1080, height: 1080 },
  { id: "16:9", width: 1920, height: 1080 },
  { id: "4:5", width: 1080, height: 1350 },
  { id: "4:3", width: 1440, height: 1080 },
];
