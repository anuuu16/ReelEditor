import { useEffect, useState } from "react";
import type { MediaSource } from "@reel-studio/shared-types";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateImageThumbnail, generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";

interface MediaThumbnailProps {
  source: MediaSource;
}

// A single representative frame for the media list — one video frame near the start, or the image
// itself, downscaled the same way ClipThumbnailStrip does. Audio has no visual frame, so it falls
// back to the kind badge (handled by the caller); this component renders nothing for it.
export function MediaThumbnail({ source }: MediaThumbnailProps) {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    if (source.isPlaceholder || source.kind === "audio") return;
    let cancelled = false;
    const key = `media-thumb:${source.id}`;
    const generate =
      source.kind === "image"
        ? () => generateImageThumbnail(source.previewUrl)
        : () => generateVideoThumbnails(source.previewUrl, 0, Math.min(1, source.durationSeconds), 1).then((frames) => frames[0] ?? null);
    getOrCreate(key, generate)
      .then((result) => {
        if (!cancelled) setFrame(result);
      })
      .catch((err) => console.error("Failed to generate media thumbnail", err));
    return () => {
      cancelled = true;
    };
  }, [source.id, source.previewUrl, source.isPlaceholder, source.kind, source.durationSeconds]);

  if (source.kind === "audio" || source.isPlaceholder || !frame) {
    return <span className={`media-thumb media-thumb-fallback media-thumb-${source.kind}`} aria-hidden="true" />;
  }

  return <img className="media-thumb" src={frame} alt="" draggable={false} />;
}
