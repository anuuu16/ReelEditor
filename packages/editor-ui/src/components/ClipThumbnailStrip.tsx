import { useEffect, useState } from "react";
import type { MediaSource } from "@reel-studio/shared-types";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";

const FRAME_WIDTH_PX = 50;
const MIN_FRAMES = 1;
const MAX_FRAMES = 8;

interface ClipThumbnailStripProps {
  source: MediaSource;
  inPoint: number;
  outPoint: number;
  widthPx: number;
}

export function ClipThumbnailStrip({ source, inPoint, outPoint, widthPx }: ClipThumbnailStripProps) {
  const count = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(widthPx / FRAME_WIDTH_PX)));
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    if (source.isPlaceholder) return;
    let cancelled = false;
    const key = `video:${source.id}:${inPoint}:${outPoint}:${count}`;
    getOrCreate(key, () => generateVideoThumbnails(source.previewUrl, inPoint, outPoint, count))
      .then((result) => {
        if (!cancelled) setFrames(result);
      })
      .catch((err) => console.error("Failed to generate thumbnails", err));
    return () => {
      cancelled = true;
    };
  }, [source.id, source.previewUrl, source.isPlaceholder, inPoint, outPoint, count]);

  if (source.isPlaceholder) {
    return (
      <div className="clip-thumbnails clip-thumbnails-placeholder">
        <span>+ Add your footage</span>
      </div>
    );
  }

  return (
    <div className="clip-thumbnails">
      {frames.map((frame, index) => (
        <img key={index} src={frame} draggable={false} alt="" />
      ))}
    </div>
  );
}
