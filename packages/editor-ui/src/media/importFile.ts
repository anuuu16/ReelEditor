import type { MediaSource } from "@reel-studio/shared-types";

function readImageMetadata(file: File, url: string): Promise<MediaSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        filePath: "",
        previewUrl: url,
        durationSeconds: 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
        kind: "image",
      });
    };
    img.onerror = () => reject(new Error(`Failed to read metadata for ${file.name}`));
    img.src = url;
  });
}

export function readMediaMetadata(file: File): Promise<MediaSource> {
  const url = URL.createObjectURL(file);

  if (file.type.startsWith("image/")) {
    return readImageMetadata(file, url);
  }

  return new Promise((resolve, reject) => {
    const isVideo = file.type.startsWith("video/");
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
