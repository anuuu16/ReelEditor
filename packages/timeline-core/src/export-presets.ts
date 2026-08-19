import type { AspectRatioPreset } from "@reel-studio/shared-types";

export interface ExportPreset {
  id: string;
  label: string;
  aspectRatio: AspectRatioPreset;
  width: number;
  height: number;
  maxDurationSeconds: number | null;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "instagram-reel", label: "Instagram Reel", aspectRatio: "9:16", width: 1080, height: 1920, maxDurationSeconds: 90 },
  { id: "tiktok", label: "TikTok", aspectRatio: "9:16", width: 1080, height: 1920, maxDurationSeconds: 600 },
  { id: "youtube-shorts", label: "YouTube Shorts", aspectRatio: "9:16", width: 1080, height: 1920, maxDurationSeconds: 60 },
  { id: "square-post", label: "Square Post", aspectRatio: "1:1", width: 1080, height: 1080, maxDurationSeconds: null },
  { id: "youtube", label: "YouTube", aspectRatio: "16:9", width: 1920, height: 1080, maxDurationSeconds: null },
];
