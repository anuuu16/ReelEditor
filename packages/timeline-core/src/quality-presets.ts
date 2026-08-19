export interface QualityTier {
  id: string;
  label: string;
  /** Multiplier applied to the project's canvas dimensions (canvas size = 1080p-equivalent scale of 1). */
  scale: number;
}

export const QUALITY_TIERS: QualityTier[] = [
  { id: "4k", label: "4K", scale: 2 },
  { id: "2k", label: "2K", scale: 4 / 3 },
  { id: "1080p", label: "1080p", scale: 1 },
  { id: "720p", label: "720p", scale: 2 / 3 },
];

export interface ExportDimensions {
  width: number;
  height: number;
}

// H.264/yuv420p requires even width/height, so every dimension is rounded to the nearest even number.
export function computeExportDimensions(canvasWidth: number, canvasHeight: number, scale: number): ExportDimensions {
  const roundEven = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: roundEven(canvasWidth), height: roundEven(canvasHeight) };
}
