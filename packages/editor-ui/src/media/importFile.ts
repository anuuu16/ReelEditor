import type { MediaSource } from "@reel-studio/shared-types";

export function readMediaMetadata(file: File): Promise<MediaSource> {
  return new Promise((resolve, reject) => {
    const isVideo = file.type.startsWith("video/");
    const url = URL.createObjectURL(file);
    const el = document.createElement(isVideo ? "video" : "audio") as HTMLVideoElement;
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        filePath: "",
        previewUrl: url,
        durationSeconds: el.duration,
        width: isVideo ? el.videoWidth : 0,
        height: isVideo ? el.videoHeight : 0,
        kind: isVideo ? "video" : "audio",
      });
    };
    el.onerror = () => reject(new Error(`Failed to read metadata for ${file.name}`));
  });
}
