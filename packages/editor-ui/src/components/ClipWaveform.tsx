import { useEffect, useState } from "react";
import type { MediaSource } from "@reel-studio/shared-types";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateAudioWaveformPeaks } from "../thumbnails/audioWaveform.js";

const BUCKET_WIDTH_PX = 4;
const MIN_BUCKETS = 8;
const MAX_BUCKETS = 240;

interface ClipWaveformProps {
  source: MediaSource;
  inPoint: number;
  outPoint: number;
  widthPx: number;
}

export function ClipWaveform({ source, inPoint, outPoint, widthPx }: ClipWaveformProps) {
  const bucketCount = Math.max(MIN_BUCKETS, Math.min(MAX_BUCKETS, Math.round(widthPx / BUCKET_WIDTH_PX)));
  const [peaks, setPeaks] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const key = `audio:${source.id}:${inPoint}:${outPoint}:${bucketCount}`;
    getOrCreate(key, () => generateAudioWaveformPeaks(source.previewUrl, inPoint, outPoint, bucketCount))
      .then((result) => {
        if (!cancelled) setPeaks(result);
      })
      .catch((err) => console.error("Failed to generate waveform", err));
    return () => {
      cancelled = true;
    };
  }, [source.id, source.previewUrl, inPoint, outPoint, bucketCount]);

  return (
    <div className="clip-waveform">
      {peaks.map((peak, index) => (
        <span key={index} className="clip-waveform-bar" style={{ height: `${Math.max(peak * 100, 6)}%` }} />
      ))}
    </div>
  );
}
